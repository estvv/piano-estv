import { HandColorsField, ThemeField } from '../components/AppearanceFields';
import { Section } from '../components/settings';
import { Page, PageHeader } from '../components/ui';
import { MusicSettings } from '../piano/Settings';

export function SettingsPage() {
  return (
    <Page width="lg">
      <PageHeader title="Réglages" subtitle="Enregistrés sur cet appareil." />
      <div className="space-y-6">
        <Section title="Apparence" description="Auto suit le mode sombre de l’appareil. Chaque thème a ses couleurs ; un morceau peut avoir les siennes, dans ses options.">
          <div className="space-y-5">
            <ThemeField />
            <div className="grid gap-5 sm:grid-cols-2">
              <HandColorsField theme="light" label="Mains · thème clair" />
              <HandColorsField theme="dark" label="Mains · thème nuit" />
            </div>
          </div>
        </Section>
        <MusicSettings />
      </div>
    </Page>
  );
}
