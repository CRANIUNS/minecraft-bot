/**
 * bot_commands.js
 * 
 * Controle de comandos do bot Minecraft (Mineflayer 1.20.1)
 */

const { pathfinder, goals: { GoalBlock, GoalNear } } = require('mineflayer-pathfinder');

let isMining = false;
let miningBlock = null;
let miningType = '1x2';

/**
 * Envia mensagem ao chat do servidor ou console.
 * @param {import('mineflayer').Bot} bot 
 * @param {string} msg 
 */
function sendMessage(bot, msg) {
    if (bot.chat) bot.chat(msg);
    else console.log(msg);
}

/**
 * Inicia mineração em 1x2 ou 3x3.
 * @param {import('mineflayer').Bot} bot 
 * @param {'1x2'|'3x3'} type 
 */
function startMining(bot, type = '1x2') {
    if (isMining) {
        sendMessage(bot, '⚠️ Já estou minerando!');
        return;
    }

    const targetBlock = bot.blockAt(bot.entity.position.offset(0, -1, 1));
    if (!targetBlock) {
        sendMessage(bot, '❌ Nenhum bloco encontrado para iniciar mineração.');
        return;
    }

    miningBlock = targetBlock;
    miningType = type;
    isMining = true;

    sendMessage(bot, `⛏️ Iniciando mineração ${miningType} em X:${targetBlock.position.x} Y:${targetBlock.position.y} Z:${targetBlock.position.z}`);
    mineLoop(bot);
}

/**
 * Para mineração.
 * @param {import('mineflayer').Bot} bot 
 */
function stopMining(bot) {
    if (!isMining) {
        sendMessage(bot, '⛔ Não estou minerando no momento.');
        return;
    }
    isMining = false;
    miningBlock = null;
    sendMessage(bot, '✅ Mineração interrompida.');
}

/**
 * Loop de mineração automático.
 * @param {import('mineflayer').Bot} bot 
 */
async function mineLoop(bot) {
    if (!isMining || !miningBlock) return;

    try {
        const radius = miningType === '3x3' ? 1 : 0;
        const blocksToMine = [];

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = 0; dy <= 1; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    const pos = miningBlock.position.offset(dx, dy, dz);
                    const block = bot.blockAt(pos);

                    if (block && bot.canDigBlock(block) && block.name !== 'air' && block.hardness !== null && block.hardness !== -1) {
                        blocksToMine.push(block);
                    }
                }
            }
        }

        if (blocksToMine.length === 0) {
            // Avança na direção que o bot está olhando
            const yaw = bot.entity.yaw;
            const dx = Math.round(Math.sin(yaw));
            const dz = Math.round(Math.cos(yaw));
            const nextPos = miningBlock.position.offset(dx, 0, dz);

            miningBlock = bot.blockAt(nextPos);
            if (!miningBlock) {
                sendMessage(bot, '⚠️ Fim da mineração: sem blocos à frente.');
                stopMining(bot);
                return;
            }

            const goal = new GoalBlock(nextPos.x, nextPos.y, nextPos.z);
            await bot.pathfinder.goto(goal);
            setImmediate(() => mineLoop(bot));
            return;
        }

        blocksToMine.sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));

        for (const block of blocksToMine) {
            if (!isMining) break;

            const goal = new GoalNear(block.position.x, block.position.y, block.position.z, 1);
            await bot.pathfinder.goto(goal);

            // Equipar ferramenta adequada
            try {
                if (bot.canDigBlock(block) && (!bot.heldItem || !bot.heldItem.name.includes('pickaxe'))) {
                    const tool = bot.inventory.items().find(i =>
                        i.name.includes('pickaxe') || i.name.includes('axe') || i.name.includes('shovel')
                    );
                    if (tool) await bot.equip(tool, 'hand');
                }
            } catch (err) {
                console.warn('⚠️ Falha ao equipar ferramenta:', err.message);
            }

            sendMessage(bot, `⛏️ Minerando bloco ${block.name} em X:${block.position.x} Y:${block.position.y} Z:${block.position.z}`);
            try {
                await bot.dig(block);
            } catch (err) {
                console.error(`Erro ao minerar bloco em ${block.position.x},${block.position.y},${block.position.z}:`, err);
            }
        }

        if (isMining) setImmediate(() => mineLoop(bot));

    } catch (err) {
        console.error('Erro no loop de mineração:', err);
        stopMining(bot);
    }
}

/**
 * Segue jogador específico.
 * @param {import('mineflayer').Bot} bot 
 * @param {string} username 
 */
async function followPlayer(bot, username) {
    const target = bot.players[username]?.entity;
    if (!target) {
        sendMessage(bot, '❌ Jogador não encontrado.');
        return;
    }
    const goal = new GoalNear(target.position.x, target.position.y, target.position.z, 1);
    bot.pathfinder.setGoal(goal);
    sendMessage(bot, `👣 Seguindo ${username}...`);
}

/**
 * Exibe status do bot.
 * @param {import('mineflayer').Bot} bot 
 */
function showStatus(bot) {
    const pos = bot.entity.position;
    sendMessage(bot, `📍 Posição: X:${pos.x.toFixed(1)} Y:${pos.y.toFixed(1)} Z:${pos.z.toFixed(1)} | Mineração: ${isMining ? 'Ativa' : 'Inativa'}`);
}

/**
 * Processa comandos do chat.
 * @param {import('mineflayer').Bot} bot 
 * @param {string} username 
 * @param {string} message 
 */
function handleChatCommand(bot, username, message) {
    if (username === bot.username) return;

    const args = message.split(' ');
    const cmd = args[0].toLowerCase();

    switch (cmd) {
        case '#minerar':
            startMining(bot, args[1] || '1x2');
            break;
        case '#parar':
            stopMining(bot);
            break;
        case '#seguir':
            followPlayer(bot, args[1]);
            break;
        case '#status':
            showStatus(bot);
            break;
        default:
            break;
    }
}

module.exports = {
    handleChatCommand,
    startMining,
    stopMining,
    followPlayer,
    showStatus
};
