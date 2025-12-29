import { PageHeader, PageHeaderHeading, PageHeaderDescription } from '@/components/page-header';
import { WhatsAppSettings } from '@/components/settings/whatsapp-settings';

export default function SettingsPage() {
  return (
    <div className="w-full max-w-full px-4 md:px-6">
      <PageHeader>
        <PageHeaderHeading>Configurações</PageHeaderHeading>
        <PageHeaderDescription>
          Gerencie as configurações da sua conta e da aplicação.
        </PageHeaderDescription>
      </PageHeader>
      <div className="space-y-8 mt-6">
        <WhatsAppSettings />
      </div>
    </div>
  );
}
