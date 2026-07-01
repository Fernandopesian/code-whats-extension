# CODE Whats

Módulo da plataforma CODE Imob para operação dentro do WhatsApp Web.

A partir da Etapa 01, esta extensão não é mais um CRM independente. Ela atua apenas como interface do usuário dentro do WhatsApp Web e deve consumir os serviços oficiais da CODE Imob.

## Responsabilidade da extensão

- Renderizar Pipeline, Clientes e Leads recebidos do CODE Imob.
- Capturar nome, telefone e mensagens visíveis da conversa ativa no WhatsApp Web.
- Abrir conversas no WhatsApp Web.
- Enviar ações para a plataforma CODE Imob por meio do provider oficial.

## O que foi removido

- CRM local independente.
- Aba Notas.
- Aba Backup.
- Importação/exportação JSON.
- Importação CSV.
- Fixados locais.
- Dados de exemplo e pipeline fictício.
- Persistência permanente dentro da extensão.

## Integração futura

O arquivo `storage.js` expõe o contrato `CodeImobProvider`, preparado para integração com:

- Supabase Auth.
- Supabase Realtime.
- Supabase Storage.
- Supabase Edge Functions.
- RLS e regras oficiais do CODE Imob.

Enquanto a API oficial não estiver conectada, o login permanece bloqueado e não há autenticação simulada.

## Instalação manual

1. Abra `chrome://extensions`.
2. Ative o modo desenvolvedor.
3. Clique em `Carregar sem compactação`.
4. Selecione a pasta deste projeto.
5. Abra `https://web.whatsapp.com/`.

