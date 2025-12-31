/instance/status
Verificar status da instância
Retorna o status atual de uma instância, incluindo:

Estado da conexão (disconnected, connecting, connected)
QR code atualizado (se em processo de conexão)
Código de pareamento (se disponível)
Informações da última desconexão
Detalhes completos da instância
Este endpoint é particularmente útil para:

Monitorar o progresso da conexão
Obter QR codes atualizados durante o processo de conexão
Verificar o estado atual da instância
Identificar problemas de conexão
Estados possíveis:

disconnected: Desconectado do WhatsApp
connecting: Em processo de conexão (aguardando QR code ou código de pareamento)
connected: Conectado e autenticado com sucesso
Responses

200
Sucesso
Response Example

{
  "instance": {
    "id": "i91011ijkl",
    "token": "abc123xyz",
    "status": "connected",
    "paircode": "1234-5678",
    "qrcode": "data:image/png;base64,iVBORw0KGg...",
    "name": "Instância Principal",
    "profileName": "Loja ABC",
    "profilePicUrl": "https://example.com/profile.jpg",
    "isBusiness": true,
    "plataform": "Android",
    "systemName": "uazapi",
    "owner": "user@example.com",
    "lastDisconnect": "2025-01-24T14:00:00Z",
    "lastDisconnectReason": "Network error",
    "adminField01": "custom_data",
    "openai_apikey": "sk-...xyz",
    "chatbot_enabled": true,
    "chatbot_ignoreGroups": true,
    "chatbot_stopConversation": "parar",
    "chatbot_stopMinutes": 60,
    "created": "2025-01-24T14:00:00Z",
    "updated": "2025-01-24T14:30:00Z",
    "currentPresence": "available"
  },
  "status": {
    "connected": false,
    "loggedIn": false,
    "jid": null
  }
}

401
Token inválido/expirado
Response Example

{
  "error": "instance info not found"
}

404
Instância não encontrada
No response body for this status code.

500
Erro interno
No response body for this status code.

curl --request GET \
  --url https://atendimento.uazapi.com/instance/status \
  --header 'Accept: application/json' \
  --header 'token: 640c7a9c-b878-414e-ac6f-1a4877153968'

  /webhook
Configurar Webhook da Instância
Gerencia a configuração de webhooks para receber eventos em tempo real da instância. Permite gerenciar múltiplos webhooks por instância através do campo ID e action.

🚀 Modo Simples (Recomendado)
Uso mais fácil - sem complexidade de IDs:

Não inclua action nem id no payload
Gerencia automaticamente um único webhook por instância
Cria novo ou atualiza o existente automaticamente
Recomendado: Sempre use "excludeMessages": ["wasSentByApi"] para evitar loops
Exemplo: {"url": "https://meusite.com/webhook", "events": ["messages"], "excludeMessages": ["wasSentByApi"]}
🧪 Sites para Testes (ordenados por qualidade)
Para testar webhooks durante desenvolvimento:

https://webhook.cool/ - ⭐ Melhor opção (sem rate limit, interface limpa)
https://rbaskets.in/ - ⭐ Boa alternativa (confiável, baixo rate limit)
https://webhook.site/ - ⚠️ Evitar se possível (rate limit agressivo)
⚙️ Modo Avançado (Para múltiplos webhooks)
Para usuários que precisam de múltiplos webhooks por instância:

💡 Dica: Mesmo precisando de múltiplos webhooks, considere usar addUrlEvents no modo simples. Um único webhook pode receber diferentes tipos de eventos em URLs específicas (ex: /webhook/message, /webhook/connection), eliminando a necessidade de múltiplos webhooks.

Criar Novo Webhook:

Use action: "add"
Não inclua id no payload
O sistema gera ID automaticamente
Atualizar Webhook Existente:

Use action: "update"
Inclua o id do webhook no payload
Todos os campos serão atualizados
Remover Webhook:

Use action: "delete"
Inclua apenas o id do webhook
Outros campos são ignorados
Eventos Disponíveis
connection: Alterações no estado da conexão
history: Recebimento de histórico de mensagens
messages: Novas mensagens recebidas
messages_update: Atualizações em mensagens existentes
call: Eventos de chamadas VoIP
contacts: Atualizações na agenda de contatos
presence: Alterações no status de presença
groups: Modificações em grupos
labels: Gerenciamento de etiquetas
chats: Eventos de conversas
chat_labels: Alterações em etiquetas de conversas
blocks: Bloqueios/desbloqueios
leads: Atualizações de leads
sender: Atualizações de campanhas, quando inicia, e quando completa
Remover mensagens com base nos filtros:

wasSentByApi: Mensagens originadas pela API ⚠️ IMPORTANTE: Use sempre este filtro para evitar loops em automações
wasNotSentByApi: Mensagens não originadas pela API
fromMeYes: Mensagens enviadas pelo usuário
fromMeNo: Mensagens recebidas de terceiros
isGroupYes: Mensagens em grupos
isGroupNo: Mensagens em conversas individuais
💡 Prevenção de Loops: Se você tem automações que enviam mensagens via API, sempre inclua "excludeMessages": ["wasSentByApi"] no seu webhook. Caso prefira receber esses eventos, certifique-se de que sua automação detecta mensagens enviadas pela própria API para não criar loops infinitos.

Ações Suportadas:

add: Registrar novo webhook
delete: Remover webhook existente
Parâmetros de URL:

addUrlEvents (boolean): Quando ativo, adiciona o tipo do evento como path parameter na URL. Exemplo: https://api.example.com/webhook/{evento}
addUrlTypesMessages (boolean): Quando ativo, adiciona o tipo da mensagem como path parameter na URL. Exemplo: https://api.example.com/webhook/{tipo_mensagem}
Combinações de Parâmetros:

Ambos ativos: https://api.example.com/webhook/{evento}/{tipo_mensagem} Exemplo real: https://api.example.com/webhook/message/conversation
Apenas eventos: https://api.example.com/webhook/message
Apenas tipos: https://api.example.com/webhook/conversation
Notas Técnicas:

Os parâmetros são adicionados na ordem: evento → tipo mensagem
A URL deve ser configurada para aceitar esses parâmetros dinâmicos
Funciona com qualquer combinação de eventos/mensagens
Request
Body
id
string
ID único do webhook (necessário para update/delete)

Example: "123e4567-e89b-12d3-a456-426614174000"

enabled
boolean
Habilita/desabilita o webhook

Example: true

url
string
required
URL para receber os eventos

Example: "https://example.com/webhook"

events
array
Lista de eventos monitorados

excludeMessages
array
Filtros para excluir tipos de mensagens

addUrlEvents
boolean
Adiciona o tipo do evento como parâmetro na URL.

false (padrão): URL normal
true: Adiciona evento na URL (ex: /webhook/message)
addUrlTypesMessages
boolean
Adiciona o tipo da mensagem como parâmetro na URL.

false (padrão): URL normal
true: Adiciona tipo da mensagem (ex: /webhook/conversation)
action
string
Ação a ser executada:

add: criar novo webhook
update: atualizar webhook existente (requer id)
delete: remover webhook (requer apenas id) Se não informado, opera no modo simples (único webhook)
Valores possíveis: add, update, delete
Responses

200
Webhook configurado ou atualizado com sucesso
Response Example

[
  {
    "id": "wh_9a8b7c6d5e",
    "enabled": true,
    "url": "https://webhook.cool/example",
    "events": [
      "messages",
      "connection"
    ],
    "addUrlTypesMessages": false,
    "addUrlEvents": false,
    "excludeMessages": []
  }
]

400
Requisição inválida
Response Example

{
  "error": "Invalid action"
}

401
Token inválido ou não fornecido
Response Example

{
  "error": "missing token"
}

500
Erro interno do servidor
Response Example

{
  "error": "Could not save webhook"
}

curl --request POST \
  --url https://atendimento.uazapi.com/webhook \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --header 'token: 640c7a9c-b878-414e-ac6f-1a4877153968' \
  --data '{
  "enabled": true,
  "url": "https://webhook.cool/example",
   "events": [
    "messages",
    "sender",
    "connection"
  ],
  "excludeMessages": [
    "wasSentByApi",
    "isGroupYes"
  ]
}'


/send/text
Enviar mensagem de texto
Envia uma mensagem de texto para um contato ou grupo.

Recursos Específicos
Preview de links com suporte a personalização automática ou customizada
Formatação básica do texto
Substituição automática de placeholders dinâmicos
Campos Comuns
Este endpoint suporta todos os campos opcionais comuns documentados na tag "Enviar Mensagem", incluindo: delay, readchat, readmessages, replyid, mentions, forward, track_source, track_id, placeholders e envio para grupos.

Preview de Links
Preview Automático
{
  "number": "5511999999999",
  "text": "Confira: https://exemplo.com",
  "linkPreview": true
}
Preview Personalizado
{
  "number": "5511999999999",
  "text": "Confira nosso site! https://exemplo.com",
  "linkPreview": true,
  "linkPreviewTitle": "Título Personalizado",
  "linkPreviewDescription": "Uma descrição personalizada do link",
  "linkPreviewImage": "https://exemplo.com/imagem.jpg",
  "linkPreviewLarge": true
}
Request
Body
number
string
required
ID do chat para o qual a mensagem será enviada. Pode ser um número de telefone em formato internacional, um ID de grupo (@g.us), um ID de usuário (com @s.whatsapp.net ou @lid).

Example: "5511999999999"

text
string
required
Texto da mensagem (aceita placeholders)

Example: "Olá {{name}}! Como posso ajudar?"

linkPreview
boolean
Ativa/desativa preview de links. Se true, procura automaticamente um link no texto para gerar preview.

Comportamento:

Se apenas linkPreview=true: gera preview automático do primeiro link encontrado no texto
Se fornecidos campos personalizados (title, description, image): usa os valores fornecidos
Se campos personalizados parciais: combina com dados automáticos do link como fallback
Example: true

linkPreviewTitle
string
Define um título personalizado para o preview do link

Example: "Título Personalizado"

linkPreviewDescription
string
Define uma descrição personalizada para o preview do link

Example: "Descrição personalizada do link"

linkPreviewImage
string
URL ou Base64 da imagem para usar no preview do link

Example: "https://exemplo.com/imagem.jpg"

linkPreviewLarge
boolean
Se true, gera um preview grande com upload da imagem. Se false, gera um preview pequeno sem upload

Example: true

replyid
string
ID da mensagem para responder

Example: "3EB0538DA65A59F6D8A251"

mentions
string
Números para mencionar (separados por vírgula)

Example: "5511999999999,5511888888888"

readchat
boolean
Marca conversa como lida após envio

Example: true

readmessages
boolean
Marca últimas mensagens recebidas como lidas

Example: true

delay
integer
Atraso em milissegundos antes do envio, durante o atraso apacerá 'Digitando...'

Example: 1000

forward
boolean
Marca a mensagem como encaminhada no WhatsApp

Example: true

track_source
string
Origem do rastreamento da mensagem

Example: "chatwoot"

track_id
string
ID para rastreamento da mensagem (aceita valores duplicados)

Example: "msg_123456789"

async
boolean
Se true, envia a mensagem de forma assíncrona via fila interna. Útil para alto volume de mensagens.

Responses

200
Mensagem enviada com sucesso
Response Example

{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "messageid": "string",
  "chatid": "string",
  "sender": "string",
  "senderName": "string",
  "isGroup": false,
  "fromMe": false,
  "messageType": "string",
  "source": "string",
  "messageTimestamp": 0,
  "status": "string",
  "text": "string",
  "quoted": "string",
  "edited": "string",
  "reaction": "string",
  "vote": "string",
  "convertOptions": "string",
  "buttonOrListid": "string",
  "owner": "string",
  "error": "string",
  "content": null,
  "wasSentByApi": false,
  "sendFunction": "string",
  "sendPayload": null,
  "fileURL": "string",
  "send_folder_id": "string",
  "track_source": "string",
  "track_id": "string",
  "ai_metadata": {
    "agent_id": "string",
    "request": {
      "messages": [
        "item"
      ],
      "tools": [
        "item"
      ],
      "options": {
        "model": "string",
        "temperature": 0,
        "maxTokens": 0,
        "topP": 0,
        "frequencyPenalty": 0,
        "presencePenalty": 0
      }
    },
    "response": {
      "choices": [
        "item"
      ],
      "toolResults": [
        "item"
      ],
      "error": "string"
    }
  },
  "sender_pn": "string",
  "sender_lid": "string",
  "response": {
    "status": "success",
    "message": "Message sent successfully"
  }
}

400
Requisição inválida
Response Example

{
  "error": "Missing number or text"
}

401
Não autorizado
Response Example

{
  "error": "Invalid token"
}

429
Limite de requisições excedido

500
Erro interno do servidor
Response Example

{
  "error": "Failed to send message"
}

curl --request POST \
  --url https://atendimento.uazapi.com/send/text \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --header 'token: 640c7a9c-b878-414e-ac6f-1a4877153968' \
  --data '{
  "number": "558189779423",
  "text": "Olá! Como posso ajudar?"
}'

/send/media
Enviar mídia (imagem, vídeo, áudio ou documento)
Envia diferentes tipos de mídia para um contato ou grupo. Suporta URLs ou arquivos base64.

Tipos de Mídia Suportados
image: Imagens (JPG preferencialmente)
video: Vídeos (apenas MP4)
document: Documentos (PDF, DOCX, XLSX, etc)
audio: Áudio comum (MP3 ou OGG)
myaudio: Mensagem de voz (alternativa ao PTT)
ptt: Mensagem de voz (Push-to-Talk)
ptv: Mensagem de vídeo (Push-to-Video)
sticker: Figurinha/Sticker
Recursos Específicos
Upload por URL ou base64
Caption/legenda opcional com suporte a placeholders
Nome personalizado para documentos (docName)
Geração automática de thumbnails
Compressão otimizada conforme o tipo
Campos Comuns
Este endpoint suporta todos os campos opcionais comuns documentados na tag "Enviar Mensagem", incluindo: delay, readchat, readmessages, replyid, mentions, forward, track_source, track_id, placeholders e envio para grupos.

Exemplos Básicos
Imagem Simples
{
  "number": "5511999999999",
  "type": "image",
  "file": "https://exemplo.com/foto.jpg"
}
Documento com Nome
{
  "number": "5511999999999",
  "type": "document",
  "file": "https://exemplo.com/contrato.pdf",
  "docName": "Contrato.pdf",
  "text": "Segue o documento solicitado"
}
Request
Body
number
string
required
ID do chat para o qual a mensagem será enviada. Pode ser um número de telefone em formato internacional, um ID de grupo (@g.us), um ID de usuário (com @s.whatsapp.net ou @lid).

Example: "5511999999999"

type
string
required
Tipo de mídia (image, video, document, audio, myaudio, ptt, ptv, sticker)

Valores possíveis: image, video, document, audio, myaudio, ptt, ptv, sticker
Example: "image"

file
string
required
URL ou base64 do arquivo

Example: "https://exemplo.com/imagem.jpg"

text
string
Texto descritivo (caption) - aceita placeholders

Example: "Veja esta foto!"

docName
string
Nome do arquivo (apenas para documents)

Example: "relatorio.pdf"

thumbnail
string
URL ou base64 de thumbnail personalizado para vídeos e documentos

Example: "https://exemplo.com/thumb.jpg"

mimetype
string
MIME type do arquivo (opcional, detectado automaticamente)

Example: "application/pdf"

replyid
string
ID da mensagem para responder

Example: "3EB0538DA65A59F6D8A251"

mentions
string
Números para mencionar (separados por vírgula)

Example: "5511999999999,5511888888888"

readchat
boolean
Marca conversa como lida após envio

Example: true

readmessages
boolean
Marca últimas mensagens recebidas como lidas

Example: true

delay
integer
Atraso em milissegundos antes do envio, durante o atraso apacerá 'Digitando...' ou 'Gravando áudio...'

Example: 1000

forward
boolean
Marca a mensagem como encaminhada no WhatsApp

Example: true

track_source
string
Origem do rastreamento da mensagem

Example: "chatwoot"

track_id
string
ID para rastreamento da mensagem (aceita valores duplicados)

Example: "msg_123456789"

async
boolean
Se true, envia a mensagem de forma assíncrona via fila interna

Responses

200
Mídia enviada com sucesso
Response Example

{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "messageid": "string",
  "chatid": "string",
  "sender": "string",
  "senderName": "string",
  "isGroup": false,
  "fromMe": false,
  "messageType": "string",
  "source": "string",
  "messageTimestamp": 0,
  "status": "string",
  "text": "string",
  "quoted": "string",
  "edited": "string",
  "reaction": "string",
  "vote": "string",
  "convertOptions": "string",
  "buttonOrListid": "string",
  "owner": "string",
  "error": "string",
  "content": null,
  "wasSentByApi": false,
  "sendFunction": "string",
  "sendPayload": null,
  "fileURL": "string",
  "send_folder_id": "string",
  "track_source": "string",
  "track_id": "string",
  "ai_metadata": {
    "agent_id": "string",
    "request": {
      "messages": [
        "item"
      ],
      "tools": [
        "item"
      ],
      "options": {
        "model": "string",
        "temperature": 0,
        "maxTokens": 0,
        "topP": 0,
        "frequencyPenalty": 0,
        "presencePenalty": 0
      }
    },
    "response": {
      "choices": [
        "item"
      ],
      "toolResults": [
        "item"
      ],
      "error": "string"
    }
  },
  "sender_pn": "string",
  "sender_lid": "string",
  "response": {
    "status": "success",
    "message": "Media sent successfully",
    "fileUrl": "https://mmg.whatsapp.net/..."
  }
}

400
Requisição inválida
Response Example

{
  "error": "Invalid media type or file format"
}

401
Não autorizado
Response Example

{
  "error": "Invalid token"
}

413
Arquivo muito grande
Response Example

{
  "error": "File size exceeds limit"
}

415
Formato de mídia não suportado
Response Example

{
  "error": "Unsupported media format"
}

500
Erro interno do servidor
Response Example

{
  "error": "Failed to upload media"
}

curl --request POST \
  --url https://atendimento.uazapi.com/send/media \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --header 'token: 640c7a9c-b878-414e-ac6f-1a4877153968' \
  --data '{
  "number": "558189779423",
  "type": "image",
  "file": "https://files.catbox.moe/f71ci7.png"
}'


/send/menu
Enviar menu interativo (botões, carrosel, lista ou enquete)
Este endpoint oferece uma interface unificada para envio de quatro tipos principais de mensagens interativas:

Botões: Para ações rápidas e diretas
Carrosel de Botões: Para uma lista horizontal de botões com imagens
Listas: Para menus organizados em seções
Enquetes: Para coleta de opiniões e votações
Suporte a campos de rastreamento: Este endpoint também suporta track_source e track_id documentados na tag "Enviar Mensagem".

Estrutura Base do Payload
Todas as requisições seguem esta estrutura base:

{
  "number": "5511999999999",
  "type": "button|list|poll|carousel",
  "text": "Texto principal da mensagem",
  "choices": ["opções baseadas no tipo escolhido"],
  "footerText": "Texto do rodapé (opcional para botões e listas)",
  "listButton": "Texto do botão (para listas)",
  "selectableCount": "Número de opções selecionáveis (apenas para enquetes)"
}
Tipos de Mensagens Interativas
1. Botões (type: "button")
Cria botões interativos com diferentes funcionalidades de ação.

Campos Específicos
footerText: Texto opcional exibido abaixo da mensagem principal
choices: Array de opções que serão convertidas em botões
Formatos de Botões
Cada botão pode ser configurado usando | (pipe) ou \n (quebra de linha) como separadores:

Botão de Resposta:

"texto|id" ou
"texto\nid" ou
"texto" (ID será igual ao texto)
Botão de Cópia:

"texto|copy:código" ou
"texto\ncopy:código"
Botão de Chamada:

"texto|call:+5511999999999" ou
"texto\ncall:+5511999999999"
Botão de URL:

"texto|https://exemplo.com" ou
"texto|url:https://exemplo.com"
Botões com Imagem
Para adicionar uma imagem aos botões, use o campo imageButton no payload:

Exemplo com Imagem
{
  "number": "5511999999999",
  "type": "button",
  "text": "Escolha um produto:",
  "imageButton": "https://exemplo.com/produto1.jpg",
  "choices": [
    "Produto A|prod_a",
    "Mais Info|https://exemplo.com/produto-a",
    "Produto B|prod_b",
    "Ligar|call:+5511999999999"
  ],
  "footerText": "Produtos em destaque"
}
Suporte: O campo imageButton aceita URLs ou imagens em base64.

Exemplo Completo
{
  "number": "5511999999999",
  "type": "button",
  "text": "Como podemos ajudar?",
  "choices": [
    "Suporte Técnico|suporte",
    "Fazer Pedido|pedido",
    "Nosso Site|https://exemplo.com",
    "Falar Conosco|call:+5511999999999"
  ],
  "footerText": "Escolha uma das opções abaixo"
}
Limitações e Compatibilidade
Importante: Ao combinar botões de resposta com outros tipos (call, url, copy) na mesma mensagem, será exibido o aviso: "Não é possível exibir esta mensagem no WhatsApp Web. Abra o WhatsApp no seu celular para visualizá-la."

2. Listas (type: "list")
Cria menus organizados em seções com itens selecionáveis.

Campos Específicos
listButton: Texto do botão que abre a lista
footerText: Texto opcional do rodapé
choices: Array com seções e itens da lista
Formato das Choices
"[Título da Seção]": Inicia uma nova seção
"texto|id|descrição": Item da lista com:
texto: Label do item
id: Identificador único, opcional
descrição: Texto descritivo adicional e opcional
Exemplo Completo
{
  "number": "5511999999999",
  "type": "list",
  "text": "Catálogo de Produtos",
  "choices": [
    "[Eletrônicos]",
    "Smartphones|phones|Últimos lançamentos",
    "Notebooks|notes|Modelos 2024",
    "[Acessórios]",
    "Fones|fones|Bluetooth e com fio",
    "Capas|cases|Proteção para seu device"
  ],
  "listButton": "Ver Catálogo",
  "footerText": "Preços sujeitos a alteração"
}
3. Enquetes (type: "poll")
Cria enquetes interativas para votação.

Campos Específicos
selectableCount: Número de opções que podem ser selecionadas (padrão: 1)
choices: Array simples com as opções de voto
Exemplo Completo
{
  "number": "5511999999999",
  "type": "poll",
  "text": "Qual horário prefere para atendimento?",
  "choices": [
    "Manhã (8h-12h)",
    "Tarde (13h-17h)",
    "Noite (18h-22h)"
  ],
  "selectableCount": 1
}
4. Carousel (type: "carousel")
Cria um carrossel de cartões com imagens e botões interativos.

Campos Específicos
choices: Array com elementos do carrossel na seguinte ordem:
[Texto do cartão]: Texto do cartão entre colchetes
{URL ou base64 da imagem}: Imagem entre chaves
Botões do cartão (um por linha):
"texto|copy:código" para botão de copiar
"texto|https://url" para botão de link
"texto|call:+número" para botão de ligação
Exemplo Completo
{
  "number": "5511999999999",
  "type": "carousel",
  "text": "Conheça nossos produtos",
  "choices": [
    "[Smartphone XYZ\nO mais avançado smartphone da linha]",
    "{https://exemplo.com/produto1.jpg}",
    "Copiar Código|copy:PROD123",
    "Ver no Site|https://exemplo.com/xyz",
    "Fale Conosco|call:+5511999999999",
    "[Notebook ABC\nO notebook ideal para profissionais]",
    "{https://exemplo.com/produto2.jpg}",
    "Copiar Código|copy:NOTE456",
    "Comprar Online|https://exemplo.com/abc",
    "Suporte|call:+5511988888888"
  ]
}
Nota: Criamos outro endpoint para carrossel: /send/carousel, funciona da mesma forma, mas com outro formato de payload. Veja o que é mais fácil para você.

Termos de uso
Os recursos de botões interativos e listas podem ser descontinuados a qualquer momento sem aviso prévio. Não nos responsabilizamos por quaisquer alterações ou indisponibilidade destes recursos.

Alternativas e Compatibilidade
Considerando a natureza dinâmica destes recursos, nosso endpoint foi projetado para facilitar a migração entre diferentes tipos de mensagens (botões, listas e enquetes).

Recomendamos criar seus fluxos de forma flexível, preparados para alternar entre os diferentes tipos.

Em caso de descontinuidade de algum recurso, você poderá facilmente migrar para outro tipo de mensagem apenas alterando o campo "type" no payload, mantendo a mesma estrutura de choices.

Request
Body
number
string
required
ID do chat para o qual a mensagem será enviada. Pode ser um número de telefone em formato internacional, um ID de grupo (@g.us), um ID de usuário (com @s.whatsapp.net ou @lid).

Example: "5511999999999"

type
string
required
Tipo do menu (button, list, poll, carousel)

Valores possíveis: button, list, poll, carousel
Example: "list"

text
string
required
Texto principal (aceita placeholders)

Example: "Escolha uma opção:"

footerText
string
Texto do rodapé (opcional)

Example: "Menu de serviços"

listButton
string
Texto do botão principal

Example: "Ver opções"

selectableCount
integer
Número máximo de opções selecionáveis (para enquetes)

Example: 1

choices
array
required
Lista de opções. Use [Título] para seções em listas

Example: ["[Eletrônicos]","Smartphones|phones|Últimos lançamentos","Notebooks|notes|Modelos 2024","[Acessórios]","Fones|fones|Bluetooth e com fio","Capas|cases|Proteção para seu device"]

imageButton
string
URL da imagem para botões (recomendado para type: button)

Example: "https://exemplo.com/imagem-botao.jpg"

replyid
string
ID da mensagem para responder

Example: "3EB0538DA65A59F6D8A251"

mentions
string
Números para mencionar (separados por vírgula)

Example: "5511999999999,5511888888888"

readchat
boolean
Marca conversa como lida após envio

Example: true

readmessages
boolean
Marca últimas mensagens recebidas como lidas

Example: true

delay
integer
Atraso em milissegundos antes do envio, durante o atraso apacerá 'Digitando...'

Example: 1000

track_source
string
Origem do rastreamento da mensagem

Example: "chatwoot"

track_id
string
ID para rastreamento da mensagem (aceita valores duplicados)

Example: "msg_123456789"

async
boolean
Se true, envia a mensagem de forma assíncrona via fila interna

Responses

200
Menu enviado com sucesso
Response Example

{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "messageid": "string",
  "chatid": "string",
  "sender": "string",
  "senderName": "string",
  "isGroup": false,
  "fromMe": false,
  "messageType": "string",
  "source": "string",
  "messageTimestamp": 0,
  "status": "string",
  "text": "string",
  "quoted": "string",
  "edited": "string",
  "reaction": "string",
  "vote": "string",
  "convertOptions": "string",
  "buttonOrListid": "string",
  "owner": "string",
  "error": "string",
  "content": null,
  "wasSentByApi": false,
  "sendFunction": "string",
  "sendPayload": null,
  "fileURL": "string",
  "send_folder_id": "string",
  "track_source": "string",
  "track_id": "string",
  "ai_metadata": {
    "agent_id": "string",
    "request": {
      "messages": [
        "item"
      ],
      "tools": [
        "item"
      ],
      "options": {
        "model": "string",
        "temperature": 0,
        "maxTokens": 0,
        "topP": 0,
        "frequencyPenalty": 0,
        "presencePenalty": 0
      }
    },
    "response": {
      "choices": [
        "item"
      ],
      "toolResults": [
        "item"
      ],
      "error": "string"
    }
  },
  "sender_pn": "string",
  "sender_lid": "string",
  "response": {
    "status": "success",
    "message": "Menu sent successfully"
  }
}

400
Requisição inválida
Response Example

{
  "error": "Missing required fields or invalid menu type"
}

401
Não autorizado
Response Example

{
  "error": "Invalid token"
}

429
Limite de requisições excedido
Response Example

{
  "error": "Rate limit exceeded"
}

500
Erro interno do servidor
Response Example

{
  "error": "Failed to send menu"
}

curl --request POST \
  --url https://atendimento.uazapi.com/send/menu \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --header 'token: 640c7a9c-b878-414e-ac6f-1a4877153968' \
  --data '{
  "number": "5511999999999",
  "type": "list",
  "text": "Escolha uma opção:",
  "footerText": "Menu de serviços",
  "listButton": "Ver opções",
  "selectableCount": 1,
  "choices": [
    "[Eletrônicos]",
    "Smartphones|phones|Últimos lançamentos",
    "Notebooks|notes|Modelos 2024",
    "[Acessórios]",
    "Fones|fones|Bluetooth e com fio",
    "Capas|cases|Proteção para seu device"
  ],
  "imageButton": "https://exemplo.com/imagem-botao.jpg",
  "replyid": "3EB0538DA65A59F6D8A251",
  "mentions": "5511999999999,5511888888888",
  "readchat": true,
  "readmessages": true,
  "delay": 1000,
  "track_source": "chatwoot",
  "track_id": "msg_123456789",
  "async": false
}'