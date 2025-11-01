// ===== CONFIGURAÇÃO =====
const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { handleChatCommand, stopMining } = require('./bot_commands'); // Adicionado

// Lê variáveis de ambiente (Render) ou usa valores padrão
const CONFIG = {
    minecraft: {
        host: process.env.MC_HOST || 'localhost',
        port: parseInt(process.env.MC_PORT) || 25565,
        username: process.env.MC_USERNAME || 'BotControlavel',
        version: process.env.MC_VERSION || '1.20.1'
    },
    web: {
        port: parseInt(process.env.PORT) || 10000,
        viewerPort: parseInt(process.env.VIEWER_PORT) || 10001
    }
};

console.log('🔧 Configuração:');
console.log('   Minecraft:', CONFIG.minecraft.host + ':' + CONFIG.minecraft.port);
console.log('   Bot:', CONFIG.minecraft.username);
console.log('   Versão:', CONFIG.minecraft.version);
console.log('   Porta Web:', CONFIG.web.port);

// ===== CRIAR BOT =====
let bot;
let reconectarTimeout;

function criarBot() {
    if (reconectarTimeout) clearTimeout(reconectarTimeout);

    bot = mineflayer.createBot({
        host: CONFIG.minecraft.host,
        port: CONFIG.minecraft.port,
        username: CONFIG.minecraft.username,
        version: CONFIG.minecraft.version,
        hideErrors: false
    });

    // Plugins
    try {
        const pathfinder = require('mineflayer-pathfinder').pathfinder;
        const Movements = require('mineflayer-pathfinder').Movements;
        bot.loadPlugin(pathfinder);

        bot.once('spawn', () => {
            console.log('✅ Bot conectado!');
            const mcData = require('minecraft-data')(bot.version);
            bot.pathfinder.setMovements(new Movements(bot, mcData));
            enviarStatus();
        });
    } catch (err) {
        console.log('⚠️  Pathfinder não disponível');
    }

    // Eventos de erro
    bot.on('error', err => {
        console.error('❌ Erro:', err.message);
        io.emit('chat', `<span style="color: #f87171;">❌ Erro: ${err.message}</span>`);
    });

    bot.on('kicked', reason => {
        console.log('⚠️  Kickado:', reason);
        io.emit('chat', `<span style="color: #fbbf24;">⚠️ Kickado: ${reason}</span>`);
        reconectar();
    });

    bot.on('end', () => {
        console.log('⚠️  Desconectado');
        reconectar();
    });

    bot.on('chat', (username, message) => {
        // Processa comandos de chat
        if (username !== bot.username) {
            handleChatCommand(bot, username, message);
        }

        // Envia para o painel web

        const cor = username === bot.username ? '#a78bfa' : '#4ade80';
        io.emit('chat', `<span style="color: ${cor};">${username}</span>: ${message}`);
    });
}

function reconectar() {
    console.log('🔄 Reconectando em 5 segundos...');
    reconectarTimeout = setTimeout(() => {
        criarBot();
    }, 5000);
}

// ===== SERVIDOR WEB =====
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Estado
let estadoTeclas = {};

// Rota principal
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
    <html lang="pt-BR">
    <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎮 Bot Minecraft</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        min-height: 100vh;
        padding: 15px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
        text-align: center;
        margin-bottom: 15px;
        text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        font-size: clamp(1.5em, 5vw, 2em);
    }
    .status {
        background: rgba(255,255,255,0.2);
        backdrop-filter: blur(10px);
        padding: 15px;
        border-radius: 12px;
        margin-bottom: 15px;
        text-align: center;
        font-size: 14px;
        line-height: 1.6;
    }
    .status.online { border-left: 5px solid #4ade80; }
    .status.offline { border-left: 5px solid #f87171; }
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
    .btn:hover {
        background: rgba(255,255,255,0.3);
        transform: translateY(-2px);
    }
    .btn:active, .btn.ativo {
        background: rgba(74, 222, 128, 0.5);
        border-color: #4ade80;
        transform: scale(0.95);
        box-shadow: 0 0 15px rgba(74, 222, 128, 0.5);
    }
    .btn-w { grid-column: 2; }
    .btn-a { grid-column: 1; grid-row: 2; }
    .btn-s { grid-column: 2; grid-row: 2; }
    .btn-d { grid-column: 3; grid-row: 2; }
    .btn-full {
        grid-column: 1 / -1;
        background: linear-gradient(135deg, rgba(99, 102, 241, 0.3), rgba(168, 85, 247, 0.3));
    }
    .acoes {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-bottom: 15px;
    }
    .info {
        background: rgba(0,0,0,0.2);
        padding: 12px;
        border-radius: 8px;
        margin-top: 15px;
        font-size: 13px;
        line-height: 1.6;
    }
    .info strong { color: #4ade80; }
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
    #chat-input::placeholder { color: rgba(255,255,255,0.6); }
    #chat-input:focus { outline: none; border-color: #4ade80; }
    #chat-output {
    background: rgba(0,0,0,0.4);
    padding: 12px;
    border-radius: 8px;
    height: 200px;
    overflow-y: auto;
    font-family: 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.5;
    }
    #chat-output::-webkit-scrollbar { width: 6px; }
    #chat-output::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
    #chat-output::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.3); border-radius: 3px; }
    .badge {
        display: inline-block;
        background: rgba(74, 222, 128, 0.3);
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 11px;
        margin: 5px 5px 0 0;
        border: 1px solid rgba(74, 222, 128, 0.5);
    }
    </style>
    </head>
    <body>
    <div class="container">
    <h1>🎮 Bot de Minecraft</h1>

    <div class="status" id="status">
    <div id="status-text">🔄 Conectando...</div>
    </div>

    <div class="grid">
    <div class="painel">
    <h2>⌨️ Movimentação</h2>
    <div class="controles">
    <button class="btn btn-w" data-key="forward">W<br>↑</button>
    <button class="btn btn-a" data-key="left">A<br>←</button>
    <button class="btn btn-s" data-key="back">S<br>↓</button>
    <button class="btn btn-d" data-key="right">D<br>→</button>
    <button class="btn btn-full" data-key="jump">ESPAÇO</button>
    <button class="btn btn-full" data-key="sneak">SHIFT</button>
    <button class="btn btn-full" data-key="sprint">SPRINT</button>
    </div>

    <div class="info">
    <strong>Controles:</strong><br>
    Use <strong>W A S D</strong> ou clique nos botões<br>
    <span class="badge">Espaço = Pular</span>
    <span class="badge">Shift = Agachar</span>
    </div>
    </div>

    <div class="painel">
    <h2>🎯 Ações</h2>
    <div class="acoes">
    <button class="btn" onclick="acao('cavar')">⛏️ Cavar</button>
    <button class="btn" onclick="acao('atacar')">⚔️ Atacar</button>
    <button class="btn" onclick="acao('usar')">✋ Usar</button>
    <button class="btn" onclick="acao('dropar')">📦 Dropar</button>
    </div>

    <h2>💬 Chat</h2>
    <input type="text" id="chat-input" placeholder="Digite e pressione Enter...">
    <div id="chat-output"></div>
    </div>
    </div>
    </div>

    <script>
    const socket = io();
    const estados = {};

    socket.on('status', (data) => {
        const el = document.getElementById('status');
        const txt = document.getElementById('status-text');

        if (data.conectado) {
            el.className = 'status online';
            const p = data.pos || {};
            txt.innerHTML = \`✅ <strong>Online</strong> | 📍 X:\${p.x?.toFixed(1)||'?'} Y:\${p.y?.toFixed(1)||'?'} Z:\${p.z?.toFixed(1)||'?'} | ❤️ \${data.vida||0}/20\`;
        } else {
            el.className = 'status offline';
            txt.innerHTML = '❌ <strong>Offline</strong>';
        }
    });

    socket.on('chat', (msg) => {
        const out = document.getElementById('chat-output');
        out.innerHTML += msg + '<br>';
        out.scrollTop = out.scrollHeight;
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

    document.querySelectorAll('.btn[data-key]').forEach(btn => {
        const key = btn.dataset.key;

        const press = () => {
            if (!estados[key]) {
                estados[key] = true;
                btn.classList.add('ativo');
                socket.emit('tecla', { key, pressed: true });
            }
        };

        const release = () => {
            if (estados[key]) {
                estados[key] = false;
                btn.classList.remove('ativo');
                socket.emit('tecla', { key, pressed: false });
            }
        };

        btn.addEventListener('mousedown', press);
        btn.addEventListener('touchstart', press);
        btn.addEventListener('mouseup', release);
        btn.addEventListener('touchend', release);
        btn.addEventListener('mouseleave', release);
    });

    const teclas = {
        'w': 'forward', 'a': 'left', 's': 'back', 'd': 'right',
        ' ': 'jump', 'shift': 'sneak', 'control': 'sprint'
    };

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
    </script>
    </body>
    </html>`);
});

// Health check para Render
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        bot: bot && bot.entity ? 'online' : 'offline'
    });
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('✅ Cliente conectado');
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
                // Para a mineração de túnel se estiver ativa para evitar conflitos
                stopMining(bot);

                const block = bot.blockAtCursor(4);
                if (block) {
                    await bot.dig(block);
                    socket.emit('chat', '<span style="color: #4ade80;">✓ Cavado!</span>');
                }
            } else if (acao === 'atacar') {
                const entity = bot.nearestEntity();
                if (entity) bot.attack(entity);
            } else if (acao === 'usar') {
                bot.activateItem();
            } else if (acao === 'dropar') {
                const item = bot.inventory.slots[bot.quickBarSlot + 36];
                if (item) {
                    await bot.toss(item.type, null, 1);
                    socket.emit('chat', '<span style="color: #4ade80;">✓ Dropado!</span>');
                }
            }
        } catch (err) {
            socket.emit('chat', '<span style="color: #f87171;">✗ ' + err.message + '</span>');
        }
    });

    socket.on('chat', (msg) => {
        if (bot) bot.chat(msg);
    });
});

function enviarStatus() {
    setInterval(() => {
        if (bot) {
            io.emit('status', {
                conectado: bot.entity !== null,
                pos: bot.entity?.position,
                vida: bot.health,
                fome: bot.food
            });
        } else {
            io.emit('status', { conectado: false });
        }
    }, 1000);
}

// Iniciar servidor
server.listen(CONFIG.web.port, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 SERVIDOR RODANDO!');
    console.log('='.repeat(60));
    console.log('📱 Porta:', CONFIG.web.port);
    console.log('='.repeat(60) + '\n');

    // Criar bot após servidor iniciar
    criarBot();
});