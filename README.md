# CODE Whats

Módulo da plataforma CODE Imob para operação dentro do WhatsApp Web.

A extensão é apenas interface: autentica o usuário CODE Master, captura contexto do WhatsApp Web, renderiza Pipeline/Clientes/Leads vindos do CODE Imob e envia ações para as RPCs oficiais do Supabase.

## Configuração Supabase

Edite `code-whats.config.js` antes de carregar a extensão:

```js
window.CODE_WHATS_CONFIG = {
  SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "SUA_ANON_KEY"
};
```

A extensão usa Supabase Auth com e-mail/senha e guarda somente a sessão em `chrome.storage.session`.

## RPCs usadas

- `code_whats_validate_login()`
- `code_whats_get_context()`
- `code_whats_find_cliente_by_phone(p_phone)`
- `code_whats_create_cliente_if_not_exists(...)`
- `code_whats_create_opportunity(...)`
- `code_whats_update_opportunity_stage(...)`
- `code_whats_save_last_messages(p_phone, p_messages)`

## Responsabilidade da extensão

- Login obrigatório via Supabase Auth.
- Validação CODE Master via RPC oficial.
- Renderização de Pipeline, Clientes e Leads recebidos por `code_whats_get_context()`.
- Captura de nome, telefone e duas últimas mensagens visíveis do WhatsApp Web.
- Abertura de conversas no WhatsApp Web.
- Envio de ações para RPCs oficiais.

## O que não existe mais

- CRM local independente.
- Notas locais.
- Backup/exportação/importação local.
- Importação CSV.
- Fixados locais.
- Dados de demonstração.
- Regras comerciais na extensão.

## Instalação manual

1. Configure `code-whats.config.js`.
2. Abra `chrome://extensions`.
3. Ative o modo desenvolvedor.
4. Clique em `Carregar sem compactação`.
5. Selecione a pasta deste projeto.
6. Abra `https://web.whatsapp.com/` e faça login com usuário CODE Master.
