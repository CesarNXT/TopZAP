'use client';
import { PageHeader, PageHeaderHeading, PageHeaderDescription } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useTutorial } from '@/components/tutorial-provider';
import { PlayCircle } from 'lucide-react';

export default function TutorialPage() {
  const { startTutorial } = useTutorial();

  return (
    <div className="container text-center">
      <PageHeader>
        <PageHeaderHeading>Tutorial Interativo</PageHeaderHeading>
        <PageHeaderDescription>
          Precisa de uma ajudinha? Clique no botão abaixo para iniciar nosso guia passo a passo e configurar sua conta.
        </PageHeaderDescription>
      </PageHeader>
      
      <Button size="lg" onClick={startTutorial}>
        <PlayCircle className="mr-2 h-5 w-5" />
        Iniciar Guia Interativo
      </Button>
    </div>
  );
}
