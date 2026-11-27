#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "music21>=9.1",
#   "pymupdf>=1.24",
#   "oemer>=0.1.8",
#   "onnxruntime-gpu<1.20",  # les modèles d'oemer cassent sur onnxruntime >= 1.20
#   "opencv-python-headless<5",  # OpenCV 5 change le format de HoughLinesP, qui casse oemer
# ]
# ///
"""Partition (PDF, photo, scan, MusicXML) -> fichier MIDI.

    uv run tools/sheet2midi.py partition.pdf
    uv run tools/sheet2midi.py page1.jpg page2.jpg -o morceau.mid --bpm 90
    uv run tools/sheet2midi.py morceau.mxl                 # MusicXML -> MIDI direct

Reconnaissance optique (OMR) :
  - Audiveris si la commande `audiveris` est installée (le plus fiable, gère
    les PDF multi-pages nativement) ;
  - sinon oemer (réseau de neurones, installé automatiquement ; le premier
    lancement télécharge ses modèles).
Forcer un moteur : --engine audiveris | oemer.

Le MusicXML intermédiaire est gardé à côté du MIDI (--keep-xml) : l'app
l'importe aussi, et il conserve mieux la séparation main droite / main gauche.

L'OMR n'est jamais parfait : sur une partition propre (édition imprimée, scan
net, 300 dpi) c'est bon ; sur une photo de travers ou une partition manuscrite,
attends-toi à des notes fausses. Ouvrir le .musicxml dans MuseScore pour
corriger avant d'exporter reste le meilleur combo.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

XML_EXT = {".musicxml", ".xml", ".mxl"}
IMG_EXT = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}


def fail(msg: str) -> None:
    print(f"erreur : {msg}", file=sys.stderr)
    sys.exit(1)


# --- OMR engines ------------------------------------------------------------

def pdf_to_images(pdf: Path, out: Path, dpi: int) -> list[Path]:
    import fitz  # pymupdf

    pages = []
    with fitz.open(pdf) as doc:
        for i, page in enumerate(doc):
            img = out / f"{pdf.stem}-p{i + 1:03d}.png"
            page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY).save(img)
            pages.append(img)
    return pages


def ensure_oemer_checkpoints() -> None:
    """oemer only checks that its first model exists before downloading all of
    them, so an interrupted first run leaves it broken for good. Fetch every
    checkpoint whose size differs from the release, atomically."""
    import urllib.request

    import oemer
    from oemer.ete import CHECKPOINTS_URL

    root = Path(oemer.__file__).parent / "checkpoints"
    for title, url in CHECKPOINTS_URL.items():
        dest = root / ("unet_big" if title.startswith("1st") else "seg_net") / title.split("_", 1)[1]
        with urllib.request.urlopen(url) as r:
            size = int(r.headers.get("Content-Length", 0))
            if dest.exists() and dest.stat().st_size == size:
                continue
            print(f"  téléchargement du modèle oemer {title} ({size // 1_000_000} Mo)…", flush=True)
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_suffix(dest.suffix + ".part")
            with open(tmp, "wb") as f:
                shutil.copyfileobj(r, f)
        tmp.replace(dest)


def run_oemer(image: Path, out: Path) -> Path:
    exe = Path(sys.executable).parent / "oemer"
    cmd = [str(exe) if exe.exists() else "oemer", str(image), "-o", str(out)]
    print(f"  oemer : {image.name} …", flush=True)
    subprocess.run(cmd, check=True)
    found = sorted(out.glob(f"{image.stem}*.musicxml"))
    if not found:
        fail(f"oemer n'a rien produit pour {image.name}")
    return found[0]


def run_audiveris(source: Path, out: Path) -> list[Path]:
    print(f"  audiveris : {source.name} …", flush=True)
    subprocess.run(["audiveris", "-batch", "-export", "-output", str(out), str(source)], check=True)
    # Audiveris writes <stem>.mxl, or <stem>.mvtN.mxl for multi-movement books.
    found = sorted(p for p in out.rglob("*") if p.suffix in {".mxl", ".musicxml"})
    if not found:
        fail(f"Audiveris n'a rien reconnu dans {source.name} (scan trop flou ?)")
    return found


def recognize(inputs: list[Path], engine: str, dpi: int, work: Path) -> list[Path]:
    """Every input -> a list of MusicXML files, in reading order."""
    xmls: list[Path] = []
    if engine == "oemer" and any(p.suffix.lower() not in XML_EXT for p in inputs):
        ensure_oemer_checkpoints()
    for i, src in enumerate(inputs):
        ext = src.suffix.lower()
        if ext in XML_EXT:
            xmls.append(src)
            continue
        out = work / f"{i:03d}"
        out.mkdir()
        if engine == "audiveris":
            xmls += run_audiveris(src, out)
        elif ext == ".pdf":
            for img in pdf_to_images(src, out, dpi):
                xmls.append(run_oemer(img, out))
        else:
            xmls.append(run_oemer(src, out))
    return xmls


# --- MusicXML -> MIDI ----------------------------------------------------------

def expand_repeats(score):
    """Play repeats and voltas through, when the engine recognised them."""
    from music21 import bar

    if not score.flatten().getElementsByClass(bar.Repeat):
        return score
    try:
        return score.expandRepeats()
    except Exception as e:  # malformed repeats from OMR: keep them unplayed
        print(f"  reprises ignorées ({e})", file=sys.stderr)
        return score


def drop_phantom_first_measure(score) -> None:
    """oemer reads the tempo mark above the first staff ("♩ = 148") as a note,
    making up a near-empty measure before the real first one: at most one
    note, shorter than the next measure, in every part."""
    measures = [list(p.getElementsByClass("Measure")) for p in score.parts]
    if not measures or any(len(ms) < 3 for ms in measures):
        return
    full = measures[0][1].duration.quarterLength
    notes = [n for ms in measures for n in ms[0].notes]
    if len(notes) > 1 or sum(n.quarterLength for n in notes) >= full:
        return
    for part, ms in zip(score.parts, measures):
        shift = ms[1].offset
        part.remove(ms[0])
        # Only the measures move: part-level clef / instrument stay at 0.
        for m in ms[1:]:
            m.number -= 1
            m.setOffsetBySite(part, m.getOffsetBySite(part) - shift)
        part.coreElementsChanged()
    print("  mesure fantôme retirée au début (indication de tempo lue comme une note)")


def merge(xmls: list[Path]):
    """Chain the pages one after the other, part by part (part 0 = main droite)."""
    from music21 import converter, stream

    scores = [expand_repeats(converter.parse(str(x))) for x in xmls]
    drop_phantom_first_measure(scores[0])
    if len(scores) == 1:
        return scores[0]

    merged = stream.Score()
    parts = max(len(s.parts) for s in scores)
    outs = [stream.Part(id=f"P{i + 1}") for i in range(parts)]
    offset = 0.0
    for s in scores:
        for i, part in enumerate(s.parts):
            for el in part.flatten().notesAndRests:
                outs[i].insert(offset + el.offset, el)
            if offset == 0:
                for mark in part.flatten().getElementsByClass("MetronomeMark"):
                    outs[i].insert(mark.offset, mark)
        offset += s.highestTime
    for p in outs:
        merged.insert(0, p)
    return merged


def to_midi(score, out: Path, bpm: float | None) -> None:
    from music21 import tempo

    if bpm:
        for part in score.parts:
            for m in part.recurse().getElementsByClass("MetronomeMark"):
                m.activeSite.remove(m)
        score.parts[0].insert(0, tempo.MetronomeMark(number=bpm))
    score.write("midi", fp=str(out))


def summary(score) -> str:
    notes = score.flatten().notes
    pitches = sum(len(n.pitches) for n in notes)
    marks = score.flatten().getElementsByClass("MetronomeMark")
    bpm = f"{marks[0].number:g} bpm" if marks and marks[0].number else "tempo par défaut (120 bpm)"
    return f"{len(score.parts)} portée(s)/partie(s), {pitches} notes, {bpm}"


# --- CLI ---------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Partition (PDF / image / MusicXML) -> MIDI")
    ap.add_argument("inputs", nargs="+", type=Path, help="PDF, images (une par page, dans l'ordre) ou MusicXML")
    ap.add_argument("-o", "--output", type=Path, help="fichier .mid de sortie (défaut : nom du 1er fichier)")
    ap.add_argument("--engine", choices=["auto", "audiveris", "oemer"], default="auto")
    ap.add_argument("--bpm", type=float, help="forcer le tempo")
    ap.add_argument("--dpi", type=int, default=300, help="résolution du rendu des PDF pour oemer (défaut 300)")
    ap.add_argument("--keep-xml", action=argparse.BooleanOptionalAction, default=True,
                    help="garder le MusicXML reconnu à côté du MIDI (défaut : oui)")
    args = ap.parse_args()

    for p in args.inputs:
        if not p.is_file():
            fail(f"fichier introuvable : {p}")
        if p.suffix.lower() not in XML_EXT | IMG_EXT | {".pdf"}:
            fail(f"format non géré : {p.name} (PDF, PNG/JPG/TIFF ou MusicXML)")

    engine = args.engine
    if engine == "auto":
        engine = "audiveris" if shutil.which("audiveris") else "oemer"
    elif engine == "audiveris" and not shutil.which("audiveris"):
        fail("commande `audiveris` introuvable (https://github.com/Audiveris/audiveris/releases)")

    out = args.output or args.inputs[0].with_suffix(".mid")
    needs_omr = any(p.suffix.lower() not in XML_EXT for p in args.inputs)
    if needs_omr:
        print(f"Reconnaissance de la partition avec {engine}…")

    with tempfile.TemporaryDirectory(prefix="sheet2midi-") as tmp:
        xmls = recognize(args.inputs, engine, args.dpi, Path(tmp))
        score = merge(xmls)
        to_midi(score, out, args.bpm)
        if needs_omr and args.keep_xml:
            xml_out = out.with_suffix(".musicxml")
            score.write("musicxml", fp=str(xml_out))
            print(f"MusicXML : {xml_out}")

    print(f"MIDI     : {out}  ({summary(score)})")
    if not args.bpm and not score.flatten().getElementsByClass("MetronomeMark"):
        print("tempo non reconnu : relance avec --bpm <valeur écrite sur la partition> pour la bonne vitesse")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        fail(f"le moteur OMR a échoué (code {e.returncode})")
    except KeyboardInterrupt:
        sys.exit(130)
