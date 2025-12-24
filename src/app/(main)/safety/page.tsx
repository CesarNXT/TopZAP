import { PageHeader, PageHeaderHeading, PageHeaderDescription } from '@/components/page-header';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Bot, BadgeDollarSign, ShieldCheck, Ban, Flame } from 'lucide-react';


export default function SafetyPage() {
  return (
    <div className="container">
      <PageHeader>
        <PageHeaderHeading>Segurança e Dúvidas Frequentes</PageHeaderHeading>
        <PageHeaderDescription>
          Entenda como o sistema funciona, os riscos envolvidos e como usar a ferramenta de forma inteligente e segura.
        </PageHeaderDescription>
      </PageHeader>
      
      <div className="space-y-8">
        
        <Accordion type="single" collapsible className="w-full" defaultValue='item-2'>
          <AccordionItem value="item-1">
            <AccordionTrigger className='text-lg'>
                <div className='flex items-center gap-3'>
                    <BadgeDollarSign className="h-6 w-6 text-primary" />
                    <span>O que é a "API Oficial" e quanto custa?</span>
                </div>
            </AccordionTrigger>
            <AccordionContent className='text-base pl-12'>
              <p className='mb-4'>Imagine que a API Oficial é como uma <strong>"Via Expressa com Pedágio"</strong> criada pela dona do WhatsApp (Meta). Ela é super rápida e confiável, mas eles cobram por cada conversa que você inicia.</p>
              <p className='mb-4'>É voltada para grandes empresas (bancos, companhias aéreas) e o custo é em dólar. Por exemplo, enviar uma campanha para 1.000 clientes pode custar mais de <strong>R$ 300,00 só naquele dia</strong>.</p>
              <p>No nosso sistema, você envia as mesmas 1.000 mensagens <strong>sem custo extra por mensagem</strong>.</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="item-2">
            <AccordionTrigger className='text-lg'>
                 <div className='flex items-center gap-3'>
                    <Bot className="h-6 w-6 text-primary" />
                    <span>Como este sistema funciona?</span>
                </div>
            </AccordionTrigger>
            <AccordionContent className='text-base pl-12'>
               <p className='mb-4'>Nós usamos um sistema inteligente que <strong>simula uma pessoa usando o WhatsApp Web</strong>. É como se você contratasse uma secretária virtual super rápida para digitar, copiar e colar suas mensagens o dia todo, 24h por dia.</p>
               <p>A grande vantagem é a economia: <strong>você não paga nada a mais por mensagem enviada.</strong></p>
            </AccordionContent>
          </AccordionItem>
          
          <AccordionItem value="item-3">
            <AccordionTrigger className='text-lg'>
                <div className='flex items-center gap-3'>
                    <ShieldCheck className="h-6 w-6 text-destructive" />
                    <span>Existe risco do meu número ser bloqueado?</span>
                </div>
            </AccordionTrigger>
            <AccordionContent className='text-base pl-12'>
               <p className='mb-2'>Sendo 100% transparente: <strong>sim, o risco existe</strong>. Como nosso sistema simula um humano, se você agir como um robô (enviando rápido demais ou sendo denunciado), o WhatsApp pode desconfiar e bloquear seu número.</p>
               <p className='font-semibold'>Como evitar isso?</p>
                <ul className="list-disc space-y-2 pl-6 mt-2">
                    <li>Use sempre o modo de envio <strong>🐢 Seguro (Recomendado)</strong>. A pressa é inimiga da automação.</li>
                    <li>Envie mensagens apenas para clientes que <strong>já te conhecem</strong> e consentiram em receber suas comunicações.</li>
                    <li><strong>"Aqueça" seu chip</strong> antes de fazer envios em massa (veja a próxima pergunta).</li>
                </ul>
                <p className='mt-4'>Seguindo as regras, o risco diminui drasticamente.</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="item-4">
            <AccordionTrigger className='text-lg'>
                <div className='flex items-center gap-3'>
                    <Flame className="h-6 w-6 text-primary" />
                    <span>O que é "Aquecer o Chip"?</span>
                </div>
            </AccordionTrigger>
            <AccordionContent className='text-base pl-12'>
                <p className='mb-4'>"Aquecer" um número de WhatsApp significa simular um comportamento humano normal por um tempo antes de iniciar os envios em massa. Um chip novo que dispara centenas de mensagens no primeiro dia tem altíssima chance de ser banido.</p>
                <p className='font-semibold'>Como aquecer corretamente?</p>
                <ol className="list-decimal space-y-2 pl-6 mt-2">
                    <li>Use um chip com <strong>mais de 15 dias de uso</strong> normal.</li>
                    <li>Comece enviando <strong>poucas mensagens por dia</strong> (ex: 50) e vá aumentando gradualmente a cada dia.</li>
                    <li>Converse manualmente com contatos, participe de grupos e troque mídias (fotos, áudios). Mostre ao WhatsApp que você é uma pessoa real.</li>
                </ol>
            </AccordionContent>
          </AccordionItem>
          
          <AccordionItem value="item-5">
            <AccordionTrigger className='text-lg'>
                <div className='flex items-center gap-3'>
                    <Ban className="h-6 w-6 text-destructive" />
                    <span>O que eu NÃO posso fazer de jeito nenhum?</span>
                </div>
            </AccordionTrigger>
            <AccordionContent className='text-base pl-12'>
                <ul className="list-disc space-y-3 pl-6 text-red-700 dark:text-red-400 font-medium">
                    <li><strong>NÃO envie SPAM:</strong> Enviar mensagens para quem não te conhece ou não consentiu é o caminho mais rápido para o bloqueio. Não compre listas de contatos.</li>
                    <li><strong>NÃO use um chip novo:</strong> Chips recém-ativados são muito mais sensíveis. Use um número com histórico de conversas.</li>
                    <li><strong>NÃO venda produtos proibidos</strong> ou envie conteúdo enganoso, ilegal ou imoral.</li>
                </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

    </div>
  );
}
