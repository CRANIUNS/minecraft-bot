const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// ===== CONFIGURAÇÃO =====
const CONFIG = {
  minecraft: {
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT) || 25565,
    username: process.env.MC_USERNAME || 'BotControlavel',
    version: process.env.MC_VERSION || '1.20.1'
  },
  web: {
    port: parseInt(process.env.PORT) || 10000
  },
  discord: {
    token: process.env.DISCORD_TOKEN || 'SEU_TOKEN_AQUI',
    enabled: process.env.DISCORD_TOKEN ? true : false
  }
};

console.log('🔧 Configuração:');
console.log('   Minecraft:', CONFIG.minecraft.host + ':' + CONFIG.minecraft.port);
console.log('   Bot:', CONFIG.minecraft.username);
console.log('   Discord:', CONFIG.discord.enabled ? 'Ativado ✅' : 'Desativado ❌');

// ===== BOT MINECRAFT =====
let bot;
let reconectarTimeout;
let modoMinerador = false;
let jogadorSeguindo = null;

function carregarPlugins() {
  try {
    const pathfinder = require('mineflayer-pathfinder').pathfinder;
    const Movements = require('mineflayer-pathfinder').Movements;
    const { GoalNear, GoalFollow, GoalBlock } = require('mineflayer-pathfinder').goals;
    
    bot.loadPlugin(pathfinder);
    
    bot.once('spawn', () => {
      console.log('✅ Bot conectado ao Minecraft!');
      const mcData = require('minecraft-data')(bot.version);
      bot.pathfinder.setMovements(new Movements(bot, mcData));
      enviarStatus();
      
      if (discordClient && discordClient.user) {
        enviarMensagemDiscord('✅ Bot conectado ao servidor Minecraft!');
      }
    });
    
    return { GoalNear, GoalFollow, GoalBlock };
  } catch (err) {
    console.log('⚠️  Pathfinder não disponível');
    return null;
  }
}

function criarBot() {
  if (reconectarTimeout) clearTimeout(reconectarTimeout);
  
  bot = mineflayer.createBot({
    host: CONFIG.minecraft.host,
    port: CONFIG.minecraft.port,
    username: CONFIG.minecraft.username,
    version: CONFIG.minecraft.version,
    hideErrors: false
  });

  const goals = carregarPlugins();

  bot.on('error', err => {
    console.error('❌ Erro:', err.message);
    io.emit('chat', `<span style="color: #f87171;">❌ Erro: ${err.message}</span>`);
  });

  bot.on('kicked', reason => {
    console.log('⚠️  Kickado:', reason);
    io.emit('chat', `<span style="color: #fbbf24;">⚠️ Kickado: ${reason}</span>`);
    if (discordClient) enviarMensagemDiscord(`⚠️ Kickado: ${reason}`);
    reconectar();
  });

  bot.on('end', () => {
    console.log('⚠️  Desconectado');
    reconectar();
  });

  bot.on('chat', (username, message) => {
    const cor = username === bot.username ? '#a78bfa' : '#4ade80';
    io.emit('chat', `<span style="color: ${cor};">${username}</span>: ${message}`);
  });

  bot.on('physicsTick', () => {
    if (modoMinerador && bot.pathfinder.isMoving() === false) {
      minerar();
    }
    
    if (jogadorSeguindo) {
      seguirJogador(jogadorSeguindo, goals);
    }
  });
  
  return goals;
}

function reconectar() {
  console.log('🔄 Reconectando em 5 segundos...');
  reconectarTimeout = setTimeout(() => {
    criarBot();
  }, 5000);
}

// ===== FUNÇÕES DO BOT =====

async function quebrarBlocoOlhando() {
  if (!bot) return { success: false, msg: 'Bot offline' };
  
  try {
    const block = bot.blockAtCursor(5);
    if (!block) {
      return { success: false, msg: 'Nenhum bloco à vista' };
    }
    
    await bot.dig(block);
    return { success: true, msg: `Quebrado: ${block.name}` };
  } catch (err) {
    return { success: false, msg: err.message };
  }
}

function seguirJogador(username, goals) {
  if (!bot || !goals) return;
  
  const player = bot.players[username];
  if (!player || !player.entity) {
    jogadorSeguindo = null;
    return;
  }
  
  const { GoalFollow } = goals;
  const goal = new GoalFollow(player.entity, 2);
  bot.pathfinder.setGoal(goal, true);
}

async function minerar() {
  if (!bot) return;
  
  const blockToMine = bot.findBlock({
    matching: (block) => {
      return block.name.includes('ore') || 
             block.name.includes('coal') || 
             block.name.includes('iron') ||
             block.name.includes('diamond') ||
             block.name.includes('gold');
    },
    maxDistance: 32
  });

  if (blockToMine) {
    try {
      await bot.pathfinder.goto(new (require('mineflayer-pathfinder').goals.GoalBlock)(
        blockToMine.position.x,
        blockToMine.position.y,
        blockToMine.position.z
      ));
      await bot.dig(blockToMine);
      io.emit('chat', `<span style="color: #4ade80;">⛏️ Minerado: ${blockToMine.name}</span>`);
    } catch (err) {
      console.log('Erro ao minerar:', err.message);
    }
  }
}

function obterInventario() {
  if (!bot) return [];
  
  const items = [];
  bot.inventory.items().forEach(item => {
    items.push({
      slot: bot.inventory.items().indexOf(item),
      name: item.name,
      displayName: item.displayName,
      count: item.count,
      durability: item.durabilityUsed || 0,
      maxDurability: item.maxDurability || 0
    });
  });
  return items;
}

function obterStatus() {
  if (!bot || !bot.entity) {
    return { online: false };
  }
  
  const pos = bot.entity.position;
  return {
    online: true,
    posicao: `X:${pos.x.toFixed(1)} Y:${pos.y.toFixed(1)} Z:${pos.z.toFixed(1)}`,
    vida: bot.health,
    fome: bot.food,
    modoMinerador: modoMinerador,
    seguindo: jogadorSeguindo || 'Ninguém'
  };
}

// ===== BOT DISCORD =====
let discordClient = null;
let canalControle = null;

if (CONFIG.discord.enabled) {
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  discordClient.on('ready', () => {
    console.log(`✅ Discord bot conectado: ${discordClient.user.tag}`);
    discordClient.user.setActivity('Minecraft', { type: 'PLAYING' });
  });

  discordClient.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const comando = message.content.toLowerCase();
    
    // Salvar canal para respostas
    if (!canalControle && message.content.startsWith('!')) {
      canalControle = message.channel;
    }
    
    // Comandos
    if (comando === '!ajuda' || comando === '!help') {
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎮 Comandos do Bot de Minecraft')
        .setDescription('Controle o bot diretamente pelo Discord!')
        .addFields(
          { name: '!status', value: 'Ver status do bot', inline: true },
          { name: '!seguir @jogador', value: 'Seguir um jogador', inline: true },
          { name: '!parar', value: 'Parar de seguir', inline: true },
          { name: '!quebrar', value: 'Quebrar bloco à vista', inline: true },
          { name: '!minerar', value: 'Ativar modo minerador', inline: true },
          { name: '!parar_minerar', value: 'Desativar minerador', inline: true },
          { name: '!inv', value: 'Ver inventário', inline: true },
          { name: '!pos', value: 'Ver posição', inline: true },
          { name: '!dizer mensagem', value: 'Falar no chat do jogo', inline: true }
        )
        .setFooter({ text: 'Bot by Atroxz' })
        .setTimestamp();
      
      message.reply({ embeds: [embed] });
    }
    
    else if (comando === '!status') {
      const status = obterStatus();
      
      if (!status.online) {
        message.reply('❌ Bot offline');
        return;
      }
      
      const embed = new EmbedBuilder()
        .setColor(status.online ? '#57F287' : '#ED4245')
        .setTitle('📊 Status do Bot')
        .addFields(
          { name: '📍 Posição', value: status.posicao, inline: false },
          { name: '❤️ Vida', value: `${status.vida}/20`, inline: true },
          { name: '🍖 Fome', value: `${status.fome}/20`, inline: true },
          { name: '⛏️ Minerador', value: status.modoMinerador ? '✅ Ativo' : '❌ Inativo', inline: true },
          { name: '👤 Seguindo', value: status.seguindo, inline: true }
        )
        .setTimestamp();
      
      message.reply({ embeds: [embed] });
    }
    
    else if (comando.startsWith('!seguir ')) {
      const username = comando.replace('!seguir ', '').replace('@', '').trim();
      jogadorSeguindo = username;
      message.reply(`✅ Seguindo: **${username}**`);
      io.emit('chat', `<span style="color: #4ade80;">💬 Discord: Seguindo ${username}</span>`);
    }
    
    else if (comando === '!parar') {
      jogadorSeguindo = null;
      if (bot) bot.pathfinder.setGoal(null);
      message.reply('✅ Parado');
    }
    
    else if (comando === '!quebrar') {
      const result = await quebrarBlocoOlhando();
      message.reply(result.success ? `✅ ${result.msg}` : `❌ ${result.msg}`);
    }
    
    else if (comando === '!minerar') {
      modoMinerador = true;
      message.reply('⛏️ Modo minerador **ATIVADO**');
      io.emit('chat', '<span style="color: #4ade80;">💬 Discord: Modo minerador ativado</span>');
    }
    
    else if (comando === '!parar_minerar') {
      modoMinerador = false;
      message.reply('✅ Modo minerador **DESATIVADO**');
    }
    
    else if (comando === '!inv' || comando === '!inventario') {
      const items = obterInventario();
      
      if (items.length === 0) {
        message.reply('📦 Inventário vazio');
        return;
      }
      
      const embed = new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle('📦 Inventário do Bot')
        .setDescription(items.map(item => `**${item.displayName}** x${item.count}`).join('\n'))
        .setFooter({ text: `Total: ${items.length} tipos de itens` })
        .setTimestamp();
      
      message.reply({ embeds: [embed] });
    }
    
    else if (comando === '!pos') {
      if (!bot || !bot.entity) {
        message.reply('❌ Bot offline');
        return;
      }
      const pos = bot.entity.position;
      message.reply(`📍 **Posição:** X:${pos.x.toFixed(1)} Y:${pos.y.toFixed(1)} Z:${pos.z.toFixed(1)}`);
    }
    
    else if (comando.startsWith('!dizer ')) {
      const msg = message.content.replace(/!dizer /i, '');
      if (bot) {
        bot.chat(msg);
        message.reply('✅ Mensagem enviada');
      } else {
        message.reply('❌ Bot offline');
      }
    }
  });

  discordClient.login(CONFIG.discord.token).catch(err => {
    console.error('❌ Erro ao conectar Discord:', err.message);
  });
}

function enviarMensagemDiscord(msg) {
  if (canalControle) {
    canalControle.send(msg).catch(err => {
      console.log('Erro ao enviar mensagem Discord:', err.message);
    });
  }
}

// ===== SERVIDOR WEB =====
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let estadoTeclas = {};

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🎮 Bot Minecraft + Discord</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #5865F2 0%, #7289DA 100%);
      color: white;
      min-height: 100vh;
      padding: 15px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 {
      text-align: center;
      margin-bottom: 15px;
      font-size: clamp(1.5em, 5vw, 2em);
      text-shadow: 2px 2px 8px rgba(0,0,0,0.3);
    }
    .discord-info {
      background: rgba(88, 101, 242, 0.3);
      border: 2px solid rgba(88, 101, 242, 0.5);
      padding: 15px;
      border-radius: 12px;
      margin-bottom: 15px;
      text-align: center;
    }
    .status {
      background: rgba(255,255,255,0.2);
      backdrop-filter: blur(10px);
      padding: 15px;
      border-radius: 12px;
      margin-bottom: 15px;
      font-size: 14px;
      line-height: 1.6;
    }
    .status.online { border-left: 5px solid #57F287; }
    .status.offline { border-left: 5px solid #ED4245; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 15px;
    }
    .painel {
      background: rgba(255,255,255,0.15);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .painel h2 {
      margin-bottom: 15px;
      font-size: 18px;
      border-bottom: 2px solid rgba(255,255,255,0.3);
      padding-bottom: 8px;
    }
    .controles {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 15px;
    }
    .btn {
      background: rgba(255,255,255,0.2);
      border: 2px solid rgba(255,255,255,0.3);
      color: white;
      padding: 15px 10px;
      border-radius: 10px;
      cursor: pointer;
      font-size: 16px;
      font-weight: bold;
      transition: all 0.2s;
      user-select: none;
      text-align: center;
    }
    .btn:hover { background: rgba(255,255,255,0.3); transform: translateY(-2px); }
    .btn:active, .btn.ativo {
      background: rgba(87, 242, 135, 0.5);
      border-color: #57F287;
      transform: scale(0.95);
    }
    .btn-w { grid-column: 2; }
    .btn-a { grid-column: 1; grid-row: 2; }
    .btn-s { grid-column: 2; grid-row: 2; }
    .btn-d { grid-column: 3; grid-row: 2; }
    .btn-full { grid-column: 1 / -1; }
    .acoes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
    #chat-input {
      width: 100%;
      padding: 12px;
      border: 2px solid rgba(255,255,255,0.3);
      background: rgba(255,255,255,0.1);
      color: white;
      border-radius: 8px;
      font-size: 14px;
      margin-bottom: 10px;
    }
    #chat-input:focus { outline: none; border-color: #57F287; }
    #chat-output {
      background: rgba(0,0,0,0.4);
      padding: 12px;
      border-radius: 8px;
      height: 200px;
      overflow-y: auto;
      font-family: 'Courier New', monospace;
      font-size: 13px;
    }
    .inventario {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
      gap: 8px;
      margin-top: 15px;
    }
    .item {
      background: rgba(0,0,0,0.3);
      padding: 10px;
      border-radius: 8px;
      text-align: center;
      font-size: 12px;
      border: 2px solid rgba(255,255,255,0.2);
    }
    .item-count {
      background: rgba(87, 242, 135, 0.3);
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: bold;
      margin-top: 5px;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎮 Bot de Minecraft + 💬 Discord</h1>
    
    <div class="discord-info">
      💬 <strong>Controle pelo Discord!</strong> Digite <code>!ajuda</code> no servidor para ver todos os comandos.
    </div>
    
    <div class="status" id="status">
      <div id="status-text">🔄 Conectando...</div>
    </div>

    <div class="grid">
      <div class="painel">
        <h2>⌨️ Movimentação</h2>
        <div class="controles">
          <button class="btn btn-w" data-key="forward">W</button>
          <button class="btn btn-a" data-key="left">A</button>
          <button class="btn btn-s" data-key="back">S</button>
          <button class="btn btn-d" data-key="right">D</button>
          <button class="btn btn-full" data-key="jump">PULAR</button>
        </div>
        
        <h2 style="margin-top: 15px;">🎯 Ações</h2>
        <div class="acoes">
          <button class="btn" onclick="acao('cavar')">⛏️ Cavar</button>
          <button class="btn" onclick="acao('atacar')">⚔️ Atacar</button>
          <button class="btn" onclick="toggleMinerar()">⛏️ Minerar</button>
          <button class="btn" onclick="acao('dropar')">📦 Dropar</button>
        </div>
      </div>

      <div class="painel">
        <h2>💬 Chat</h2>
        <input type="text" id="chat-input" placeholder="Digite e pressione Enter...">
        <div id="chat-output"></div>
      </div>
      
      <div class="painel">
        <h2>📦 Inventário</h2>
        <div id="inventario" class="inventario">Carregando...</div>
      </div>
    </div>
  </div>

  <script>
    const socket = io();
    const estados = {};
    let minerando = false;

    socket.on('status', (data) => {
      const el = document.getElementById('status');
      const txt = document.getElementById('status-text');
      
      if (data.conectado) {
        el.className = 'status online';
        const p = data.pos || {};
        txt.innerHTML = \`✅ Online | 📍 X:\${p.x?.toFixed(1)||'?'} Y:\${p.y?.toFixed(1)||'?'} Z:\${p.z?.toFixed(1)||'?'} | ❤️ \${data.vida||0}/20 | ⛏️ \${data.modoMinerador?'Minerando':'Parado'}\`;
      } else {
        el.className = 'status offline';
        txt.innerHTML = '❌ Offline';
      }
    });

    socket.on('chat', (msg) => {
      const out = document.getElementById('chat-output');
      out.innerHTML += msg + '<br>';
      out.scrollTop = out.scrollHeight;
    });
    
    socket.on('inventario', (items) => {
      const inv = document.getElementById('inventario');
      if (items.length === 0) {
        inv.innerHTML = '<div style="text-align:center;padding:20px;">Vazio</div>';
        return;
      }
      
      inv.innerHTML = items.map(item => \`
        <div class="item">
          <div>\${item.displayName}</div>
          <div class="item-count">x\${item.count}</div>
        </div>
      \`).join('');
    });

    document.getElementById('chat-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) {
        socket.emit('chat', e.target.value);
        e.target.value = '';
      }
    });

    function acao(tipo) {
      socket.emit('acao', tipo);
    }
    
    function toggleMinerar() {
      minerando = !minerando;
      socket.emit('acao', minerando ? 'minerar' : 'parar_minerar');
    }

    document.querySelectorAll('.btn[data-key]').forEach(btn => {
      const key = btn.dataset.key;
      btn.addEventListener('mousedown', () => {
        estados[key] = true;
        btn.classList.add('ativo');
        socket.emit('tecla', { key, pressed: true });
      });
      btn.addEventListener('mouseup', () => {
        estados[key] = false;
        btn.classList.remove('ativo');
        socket.emit('tecla', { key, pressed: false });
      });
    });

    const teclas = { 'w': 'forward', 'a': 'left', 's': 'back', 'd': 'right', ' ': 'jump' };

    document.addEventListener('keydown', (e) => {
      const key = teclas[e.key.toLowerCase()];
      if (key && !estados[key]) {
        estados[key] = true;
        document.querySelector(\`[data-key="\${key}"]\`)?.classList.add('ativo');
        socket.emit('tecla', { key, pressed: true });
        e.preventDefault();
      }
    });

    document.addEventListener('keyup', (e) => {
      const key = teclas[e.key.toLowerCase()];
      if (key && estados[key]) {
        estados[key] = false;
        document.querySelector(\`[data-key="\${key}"]\`)?.classList.remove('ativo');
        socket.emit('tecla', { key, pressed: false });
      }
    });
    
    setInterval(() => socket.emit('get_inventario'), 2000);
  </script>
</body>
</html>`);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', bot: bot && bot.entity ? 'online' : 'offline' });
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('✅ Cliente web conectado');
  enviarStatus();
  
  socket.on('tecla', (data) => {
    if (bot) {
      const { key, pressed } = data;
      estadoTeclas[key] = pressed;
      bot.setControlState(key, pressed);
    }
  });
  
  socket.on('acao', async (acao) => {
    if (!bot) return;
    try {
      if (acao === 'cavar') {
        const result = await quebrarBlocoOlhando();
        socket.emit('chat', result.success ? 
          `<span style="color: #57F287;">✓ ${result.msg}</span>` :
          `<span style="color: #ED4245;">✗ ${result.msg}</span>`
        );
      } else if (acao === 'atacar') {
        const entity = bot.nearestEntity();
        if (entity) bot.attack(entity);
      } else if (acao === 'minerar') {
        modoMinerador = true;
        socket.emit('chat', '<span style="color: #57F287;">⛏️ Modo minerador ATIVADO</span>');
      } else if (acao === 'parar_minerar') {
        modoMinerador = false;
        socket.emit('chat', '<span style="color: #57F287;">✓ Modo minerador DESATIVADO</span>');
      } else if (acao === 'dropar') {
        const item = bot.inventory.slots[bot.quickBarSlot + 36];
        if (item) {
          await bot.toss(item.type, null, 1);
          socket.emit('chat', '<span style="color: #57F287;">✓ Dropado!</span>');
        }
      }
    } catch (err) {
      socket.emit('chat', '<span style="color: #ED4245;">✗ ' + err.message + '</span>');
    }
  });
  
  socket.on('chat', (msg) => {
    if (bot) bot.chat(msg);
  });
  
  socket.on('get_inventario', () => {
    socket.emit('inventario', obterInventario());
  });
});

function enviarStatus() {
  setInterval(() => {
    if (bot) {
      io.emit('status', {
        conectado: bot.entity !== null,
        pos: bot.entity?.position,
        vida: bot.health,
        fome: bot.food,
        modoMinerador: modoMinerador
      });
    } else {
      io.emit('status', { conectado: false });
    }
  }, 1000);
}

// Iniciar
server.listen(CONFIG.web.port, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 SERVIDOR RODANDO!');
  console.log('='.repeat(60));
  console.log('📱 Porta Web:', CONFIG.web.port);
  if (CONFIG.discord.enabled) {
    console.log('💬 Discord: Ativo - Digite !ajuda no servidor');
  }
  console.log('='.repeat(60) + '\n');
  criarBot();
});
