# Nexo

Rede para **chamadas de voz**, **compartilhamento de tela** e **mensagens privadas**, com visual inspirado no Discord.

## Como rodar

```bash
npm install
npm run dev
```

Abra [http://localhost:5173](http://localhost:5173). O servidor de sinalização sobe junto na porta **3001**.

## Contas, amigos e grupos

1. Crie uma conta (usuário + senha).
2. Em **Amigos**, pesquise e adicione amigos; aceite o pedido no outro lado.
3. No **+** da barra esquerda, **crie um grupo** ou entre com o **código de convite**.
4. No grupo, crie canais de **texto** e de **voz**.
5. Só dá para estar em **uma** ligação por vez (DM ou canal de voz).
6. Mensagens privadas não lidas aparecem como avatar na barra esquerda; ao abrir, saem dali.
7. Em **Configurações**, ajuste perfil, qualidade de vídeo (360p/480p/720p) e FPS.

Só amigos conseguem DM/ligar. Microfone e tela precisam de HTTPS (ou localhost).

## Online (Cloudflare)

**https://nexo.nexo-app.workers.dev**

```bash
npm run deploy
```

Contas, amigos e grupos ficam no Durable Object da Cloudflare.

Atualizações no estilo **Discord**:

- A UI do Electron vem do hub online → cada `npm run deploy` já atualiza todo mundo (faixa “Reiniciar” se o app ficou aberto).
- O popup/faixa **“Baixar e instalar”** só aparece se a **casca Electron** estiver desatualizada **e** o `.exe` estiver hospedado de verdade.

Publicar instalador (opcional — GitHub Releases, R2 ou `NEXO_INSTALLER_URL`):

```powershell
npm run desktop:build
npm run desktop:publish
```

## App desktop (Electron — mesma estratégia do Discord)

O Nexo Desktop usa **Electron** (igual Discord/Slack/VS Code):

- Janela nativa + bandeja + atalhos
- Interface carregada do hub online → cada `deploy` atualiza o app (popup + “Atualizar agora”)
- Microfone/câmera **sem** diálogo “http://… wants to use”
- Servidor online para chat/chamadas e UI

### Gerar instalador

```powershell
cd C:\Users\LK\Desktop\bat
.\scripts\build-desktop.bat
```

Arquivos em `%USERPROFILE%\.nexo-build\electron-dist\`:

- `Nexo-Setup-*.exe` — instalador (versões antigas são apagadas a cada build)

Para limpar manualmente: `npm run desktop:clean`

### Dev desktop

```powershell
npm run desktop:dev
```

## Produção local (um processo só)

```bash
npm run build
npm start
```

Sobe em `http://localhost:3001` e já inclui o app + sinalização.

## LAN / Radmin

No outro dispositivo, use o IP da máquina (`http://SEU-IP:5173` em dev, ou `:3001` após o build).

Chamadas usam WebRTC com STUN + TURN público para funcionar entre redes diferentes.
