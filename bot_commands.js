// bot_commands.js

const { GoalNear, GoalBlock, GoalXZ, GoalY } = require('mineflayer-pathfinder').goals;

// Variáveis de estado
let isAuthenticated = false;
const AUTH_PASSWORD = process.env.BOT_PASSWORD || 'minhasenha123'; // Senha de autenticação
let isMining = false;
let miningType = '1x2'; // '1x2' ou '3x3'
let miningBlock = null;

/**
 * Função para enviar uma mensagem de chat no Minecraft.
 * @param {import('mineflayer').Bot} bot
 * @param {string} message
 */
function sendMessage(bot, message) {
    bot.chat(message);
}

/**
 * Função para processar comandos de chat.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 * @param {string} message
 */
function handleChatCommand(bot, username, message) {
    if (!message.startsWith('#')) return;

    const parts = message.slice(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    // --- Comandos de Autenticação ---
    if (command === 'senha') {
        if (args[0] === AUTH_PASSWORD) {
            isAuthenticated = true;
            sendMessage(bot, `✅ ${username}, autenticação bem-sucedida. Você agora pode usar os comandos de controle.`);
        } else {
            sendMessage(bot, `❌ ${username}, senha incorreta.`);
        }
        return;
    }

    if (!isAuthenticated) {
        sendMessage(bot, `⚠️ ${username}, você precisa se autenticar primeiro. Use #senha <sua_senha>`);
        return;
    }


    // --- Comandos de Automação ---
    switch (command) {
        case 'seguir':
            handleFollowCommand(bot, username, args);
            break;
        case 'parar':
            handleStopCommand(bot, username);
            break;
        case 'minerar':
            handleMineCommand(bot, username, args);
            break;
        case 'status':
            handleStatusCommand(bot, username);
            break;
        case 'ajuda':
            handleHelpCommand(bot, username);
            break;
        default:
            sendMessage(bot, `❌ Comando #${command} desconhecido. Use #ajuda para ver a lista de comandos.`);
            break;
    }
}

/**
 * Lógica para o comando /!seguir.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 * @param {string[]} args
 */
function handleFollowCommand(bot, username, args) {
    const targetName = args[0] || username;
    const target = bot.players[targetName]?.entity;

    if (!target) {
        sendMessage(bot, `❌ Jogador ${targetName} não encontrado ou não está visível.`);
        return;
    }

    // Para de minerar se estiver ativo
    if (isMining) {
        stopMining(bot);
    }

    const goal = new GoalNear(target.position.x, target.position.y, target.position.z, 1);
    bot.pathfinder.setGoal(goal);
    sendMessage(bot, `🏃 Seguindo ${targetName}...`);
}

/**
 * Lógica para o comando /!parar.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 */
function handleStopCommand(bot, username) {
    bot.pathfinder.stop();
    stopMining(bot);
    sendMessage(bot, `🛑 Parado.`);
}

/**
 * Lógica para o comando /!minerar.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 * @param {string[]} args
 */
function handleMineCommand(bot, username, args) {
    if (isMining) {
        sendMessage(bot, `⚠️ Já estou minerando. Use #parar para interromper.`);
        return;
    }

    const type = args[0] || '1x2';
    if (type !== '1x2' && type !== '3x3') {
        sendMessage(bot, `❌ Tipo de mineração inválido. Use '1x2' ou '3x3'. Ex: #minerar 3x3`);
        return;
    }

    miningType = type;
    isMining = true;
    miningBlock = null; // Reinicia o bloco de mineração

    // Obtém o bloco que o bot está olhando
    const block = bot.blockAtCursor(5); // 5 blocos de distância

    if (!block) {
        sendMessage(bot, `❌ Não estou olhando para um bloco válido para começar a mineração.`);
        isMining = false;
        return;
    }

    miningBlock = block;
    sendMessage(bot, `⛏️ Iniciando mineração ${miningType} a partir de X:${block.position.x} Y:${block.position.y} Z:${block.position.z}`);

    // Inicia o loop de mineração
    mineLoop(bot);
}

/**
 * Função principal do loop de mineração.
 * @param {import('mineflayer').Bot} bot
 */
async function mineLoop(bot) {
    if (!isMining || !miningBlock) return;

    try {
        const { x, y, z } = miningBlock.position;
        const radius = miningType === '3x3' ? 1 : 0; // 1 para 3x3, 0 para 1x2 (apenas o bloco central)

        // Define a área de mineração (túnel)
        const blocksToMine = [];
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = 0; dy <= 1; dy++) { // Altura 2 blocos
                for (let dz = -radius; dz <= radius; dz++) {
                    const blockPos = miningBlock.position.offset(dx, dy, dz);
                    const block = bot.blockAt(blockPos);

                    // Evita minerar blocos inquebráveis ou ar
                    if (block && bot.canDigBlock(block) && block.name !== 'air' && block.hardness !== null && block.hardness !== -1) {
                        blocksToMine.push(block);
                    }
                }
            }
        }

        if (blocksToMine.length === 0) {
            // Avança para o próximo bloco
            const nextBlockPos = miningBlock.position.offset(0, 0, 1); // Avança 1 bloco no eixo Z (assumindo que o bot está olhando para Z positivo)
            miningBlock = bot.blockAt(nextBlockPos);

            if (!miningBlock) {
                sendMessage(bot, `⚠️ Fim da mineração: Não há mais blocos para avançar.`);
                stopMining(bot);
                return;
            }

            // Move o bot para a posição do próximo bloco
            const goal = new GoalBlock(nextBlockPos.x, nextBlockPos.y, nextBlockPos.z);
            await bot.pathfinder.goto(goal);

            // Continua o loop
            mineLoop(bot);
            return;
        }

        // Minera os blocos
        for (const block of blocksToMine) {
            await bot.dig(block);
        }

        // Continua o loop
        mineLoop(bot);

    } catch (err) {
        if (isMining) {
            sendMessage(bot, `❌ Erro durante a mineração: ${err.message}. Parando.`);
            stopMining(bot);
        }
    }
}

/**
 * Para o processo de mineração.
 * @param {import('mineflayer').Bot} bot
 */
function stopMining(bot) {
    isMining = false;
    miningBlock = null;
    bot.pathfinder.stop();
}

/**
 * Lógica para o comando /!status.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 */
function handleStatusCommand(bot, username) {
    const pos = bot.entity.position;
    const status = `
        🤖 Status do Bot:
        - Conectado: Sim
        - Autenticado: ${isAuthenticated ? 'Sim' : 'Não'}
        - Posição: X:${pos.x.toFixed(1)} Y:${pos.y.toFixed(1)} Z:${pos.z.toFixed(1)}
        - Vida: ${bot.health.toFixed(0)}/20
        - Fome: ${bot.food.toFixed(0)}/20
        - Mineração: ${isMining ? \`Ativa (${miningType})\` : 'Inativa'}
    `.trim().replace(/\s+/g, ' '); // Remove espaços extras para caber no chat

    sendMessage(bot, status);
}

/**
 * Lógica para o comando /!ajuda.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 */
function handleHelpCommand(bot, username) {
    const helpMessage = `
        Comandos disponíveis (prefixo #):
        - senha <senha>: Autentica para usar comandos.
        - seguir [jogador]: Segue um jogador (padrão: você).
        - parar: Para qualquer ação (seguir, minerar).
        - minerar [1x2|3x3]: Inicia mineração de túnel.
        - status: Mostra o estado atual do bot.
        - ajuda: Mostra esta mensagem.
    `.trim().replace(/\s+/g, ' ');

    sendMessage(bot, helpMessage);
}

module.exports = {
    handleChatCommand,
    stopMining
};
