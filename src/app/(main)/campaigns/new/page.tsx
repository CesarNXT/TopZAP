import { PageHeader, PageHeaderHeading, PageHeaderDescription } from '@/components/page-header';
import { CreateCampaignForm } from '@/components/campaigns/create-campaign-form';

export default function NewCampaignPage() {
  return (
    <div className="container px-4 py-6 md:px-6 lg:py-8">
      <PageHeader className="mb-6">
        <PageHeaderHeading>Criar Nova Campanha</PageHeaderHeading>
        <PageHeaderDescription>
          Crie, personalize e agende suas campanhas WhatsApp com um preview em tempo real.
        </PageHeaderDescription>
      </PageHeader>
      
      <CreateCampaignForm />
    </div>
  );
}
