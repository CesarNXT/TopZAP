import { PageHeader, PageHeaderHeading, PageHeaderDescription } from '@/components/page-header';
import { CreateCampaignWizard } from '@/components/campaigns/create-campaign-wizard';

export default function NewCampaignPage() {
  return (
    <div className="container px-4 py-6 md:px-6 lg:py-8">
      <PageHeader className="mb-6">
        <PageHeaderHeading>Criar Nova Campanha</PageHeaderHeading>
        <PageHeaderDescription>
          Siga os passos para criar, personalizar e agendar sua campanha do WhatsApp.
        </PageHeaderDescription>
      </PageHeader>
      
      <CreateCampaignWizard />
    </div>
  );
}
