# CODE Whats Local

Extensão Chrome Manifest V3 para transformar o WhatsApp Web em um CRM Kanban local, pessoal e sem backend.

## O que esta versão faz

- Injeta um painel lateral direito no `https://web.whatsapp.com/*`.
- Permite abrir e fechar o painel CODE Whats.
- Mostra dashboard com total de clientes, clientes quentes, follow-ups e valor estimado em negociação.
- Cria funis personalizados.
- Cria colunas Kanban personalizadas.
- Cria, edita e exclui clientes manualmente.
- Exibe clientes em cards Kanban premium.
- Permite arrastar clientes entre colunas.
- Abre a conversa do WhatsApp Web ao clicar no card do cliente.
- Salva tudo em `chrome.storage.local`.
- Exporta e importa backup em JSON.
- Cria dados de exemplo no primeiro uso.

## Limites intencionais

Esta primeira versão não faz envio em massa, não executa automações agressivas e não tenta contornar regras do WhatsApp. O foco é organização pessoal, CRM local e uma base sólida para futuras integrações.

## Arquivos

- `manifest.json`: configuração Manifest V3.
- `storage.js`: leitura, normalização e gravação no `chrome.storage.local`.
- `content.js`: painel lateral, Kanban, formulários, drag and drop e backup.
- `styles.css`: identidade visual dark premium.
- `popup.html`: popup da extensão.
- `popup.js`: ações rápidas do popup e backup.
- `README.md`: instruções do projeto.

## Como instalar manualmente no Chrome

1. Abra o Chrome.
2. Acesse `chrome://extensions/`.
3. Ative o `Modo do desenvolvedor` no canto superior direito.
4. Clique em `Carregar sem compactação`.
5. Selecione a pasta deste projeto: `CODE Imob`.
6. Abra `https://web.whatsapp.com/`.
7. Aguarde o WhatsApp Web carregar e use o botão `CODE` no canto inferior direito para abrir ou fechar o CRM.

## Como usar

1. Escolha ou crie um funil.
2. Crie colunas para representar seu processo comercial.
3. Clique em `Cliente` para cadastrar um contato.
4. Arraste os cards entre as colunas conforme o avanço da negociação.
5. Clique em um card para abrir a conversa no WhatsApp Web pelo telefone cadastrado.
6. Use `Exportar JSON` para criar um backup local.
7. Use `Importar JSON` para restaurar um backup.

## Observações técnicas

Todos os dados ficam apenas no navegador, dentro do `chrome.storage.local`. Não há login, servidor, banco externo, framework ou transmissão de dados para terceiros.
