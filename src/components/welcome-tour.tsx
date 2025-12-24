'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from '@/components/ui/carousel';
import { ArrowLeft, ArrowRight, User, Smartphone, ShieldCheck, Rocket } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTutorial } from './tutorial-provider';

const tourSteps = [
  {
    icon: User,
    title: 'Passo 1: Seu Perfil',
    description: 'Vamos começar configurando seu nome. Ele será usado como identificação da sua empresa nas comunicações.',
    image: 'https://files.catbox.moe/k3v129.png',
    buttonText: 'Ir para Configurações',
    href: '/settings',
  },
  {
    icon: Smartphone,
    title: 'Passo 2: Conectar seu WhatsApp',
    description: 'Esta é a etapa mais importante. Aqui você vai conectar o número de celular que fará os disparos das campanhas.',
    image: 'https://files.catbox.moe/u0y6er.png',
    buttonText: 'Ir para Conectar',
    href: '/whatsapp-connect',
  },
  {
    icon: ShieldCheck,
    title: 'Passo 3: Segurança em Primeiro Lugar',
    description: 'Antes de disparar, leia nossas dicas de segurança para entender como usar a ferramenta de forma inteligente e evitar bloqueios.',
    image: 'https://files.catbox.moe/k5w2ay.png',
    buttonText: 'Entender os Riscos',
    href: '/safety',
  },
  {
    icon: Rocket,
    title: 'Tudo Pronto para Decolar!',
    description: 'Com tudo configurado, você já pode criar sua primeira campanha e começar a engajar seus clientes.',
    image: 'https://files.catbox.moe/s133a8.png',
    buttonText: 'Criar Primeira Campanha',
    href: '/campaigns/new',
  },
];

export function WelcomeTour() {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const router = useRouter();
  const { isTourOpen, completeTutorial } = useTutorial();

  useEffect(() => {
    if (!api) return;

    const updateCurrentSlide = () => {
      setCurrent(api.selectedScrollSnap() + 1);
    };

    updateCurrentSlide();
    api.on('select', updateCurrentSlide);
    
    return () => {
      api.off('select', updateCurrentSlide);
    };
  }, [api]);
  
  const handleActionClick = () => {
    const step = tourSteps[current - 1];
    if (step?.href) {
      router.push(step.href);
    }
    completeTutorial();
  };

  const handleSkip = () => {
    completeTutorial();
  };

  if (!isTourOpen) {
    return null;
  }

  return (
    <Dialog open={isTourOpen} onOpenChange={(open) => !open && completeTutorial()}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-2xl text-center">Bem-vindo ao TOPzap!</DialogTitle>
          <DialogDescription className="text-center">
            Vamos configurar sua conta em poucos passos.
          </DialogDescription>
        </DialogHeader>
        <Carousel setApi={setApi} className="w-full">
          <CarouselContent>
            {tourSteps.map((step, index) => (
              <CarouselItem key={index} className="px-6">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="relative w-full h-48 rounded-lg overflow-hidden border">
                     <Image
                        src={step.image}
                        alt={step.title}
                        layout="fill"
                        objectFit="contain"
                        className="p-4"
                     />
                  </div>
                  <div className="flex items-center gap-3">
                    <step.icon className="h-6 w-6 text-primary" />
                    <h3 className="text-xl font-semibold">{step.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                   <Button onClick={handleActionClick} className="w-full">
                        {step.buttonText}
                    </Button>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <div className="flex items-center justify-center p-4">
              <Button variant="ghost" size="icon" onClick={() => api?.scrollPrev()} disabled={current === 1}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex-1 text-center text-sm text-muted-foreground">
                Passo {current} de {tourSteps.length}
              </div>
              <Button variant="ghost" size="icon" onClick={() => api?.scrollNext()} disabled={current === tourSteps.length}>
                <ArrowRight className="h-5 w-5" />
              </Button>
          </div>
        </Carousel>
        <DialogFooter className="sm:justify-between px-6 pb-6 border-t pt-4">
            <Button variant="link" onClick={handleSkip}>Pular Tour</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
