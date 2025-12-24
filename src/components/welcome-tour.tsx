'use client';

import React from 'react';
import Joyride, { Step, CallBackProps, STATUS } from 'react-joyride';
import { useTutorial } from './tutorial-provider';
import { useTheme } from 'next-themes';

const tourSteps: Step[] = [
    {
      target: 'body',
      content: 'Vamos configurar tudo em 30 segundos? Clique em Próximo.',
      title: 'Bem-vindo ao WhatsConnect!',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '#tour-connect-wa',
      title: 'Primeiro Passo',
      content: 'Escaneie o QR Code aqui para conectar seu WhatsApp.',
      placement: 'right',
    },
    {
      target: '#tour-stats-card',
      title: 'Seus Resultados',
      content: 'Aqui você vai ver quantas mensagens foram enviadas.',
       placement: 'bottom',
    },
    {
      target: '#tour-new-campaign',
      title: 'Mandar Mensagem',
      content: 'Quando estiver pronto, clique aqui para criar seu primeiro disparo.',
       placement: 'left',
    },
  ];

export function WelcomeTour() {
  const { isTourRunning, completeTutorial, runTour } = useTutorial();
  const { theme } = useTheme();

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status, action } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

    if (finishedStatuses.includes(status)) {
      completeTutorial();
    }
    
    // If the user closes the tour with the 'X' button
    if (action === 'close') {
        completeTutorial();
    }
  };

  return (
    <Joyride
        steps={tourSteps}
        run={isTourRunning}
        continuous
        showProgress
        showSkipButton
        callback={handleJoyrideCallback}
        styles={{
            options: {
              arrowColor: theme === 'dark' ? '#111827' : '#fff',
              backgroundColor: theme === 'dark' ? '#111827' : '#fff',
              primaryColor: '#25D366',
              textColor: theme === 'dark' ? '#f8fafc' : '#0f172a',
              zIndex: 1000,
            },
            buttonNext: {
                backgroundColor: '#25D366',
                color: 'white'
            },
            buttonBack: {
                color: theme === 'dark' ? '#f8fafc' : '#0f172a'
            },
            spotlight: {
                borderRadius: '8px',
            }
        }}
        locale={{
            back: 'Anterior',
            close: 'Fechar',
            last: 'Fim',
            next: 'Próximo',
            skip: 'Pular',
        }}
    />
  );
}
