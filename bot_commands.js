/**
 * bot_commands.js
 * 
 * Módulo de comandos do bot para Minecraft 1.20.1
 * Compatível com mineflayer e mineflayer-pathfinder.
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock, GoalNear } } = require('mineflayer-pathfinder');
const Vec3 = require('vec3').Vec3;

let isMining = false;
let miningBlock = null;
let miningType = '1x2'; // padrão

function sendMessage(bot, msg) {
    if (bot.chat) bot.chat(msg);
    else console.log(msg);
}

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

function stopMining(bot) {
    if (!isMining) {
        sendMessage(bot, '⛔ Não estou minerando no momento.');
        return;
    }
    isMining = false;
    miningBlock = null;
    sendMessage(bot, '✅ Mineração interrompida.');
}

async function mineLoop(bot) {
    if (!isMining || !miningBlock) return;

    try {
        const radius = miningType === '3x3' ? 1 : 0;
        const blocksToMine = [];

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = 0; dy <= 1; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    const blockPos = miningBlock.position.offset(dx, dy, dz);
                    const block = bot.blockAt(blockPos);

                    if (block && bot.canDigBlock(block) && block.name !== 'air' && block.hardness !== null && block.hardness !== -1) {
                        blocksToMine.push(block);
                    }
                }
            }
        }

        if (blocksToMine.length === 0) {
            // 🔄 Avança dinamicamente na direção atual do bot
            const yaw = bot.entity.yaw;
            const dx = Math.round(Math.sin(yaw));
            const dz = Math.round(Math.cos(yaw));
            const nextBlockPos = miningBlock.position.offset(dx, 0, dz);

            miningBlock = bot.blockAt(nextBlockPos);
            if (!miningBlock) {
                sendMessage(bot, '⚠️ Fim da mineração: sem blocos à frente.');
                stopMining(bot);
                return;
            }

            const goal = new GoalBlock(nextBlockPos.x, nextBlockPos.y, nextBlockPos.z);
            await bot.pathfinder.goto(goal);
            setImmediate(() => mineLoop(bot));
            return;
        }

        blocksToMine.sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));

        for (const block of blocksToMine) {
            if (!isMining) break;

            const goal = new GoalNear(block.position.x, block.position.y, block.position.z, 1);
            await bot.pathfinder.goto(goal);

            try {
                if (bot.canDigBlock(block) && (!bot.heldItem || !bot.heldItem.name.includes('pickaxe'))) {
                    const tool = bot.inventory.items().find(i =>
                        i.name.includes('pickaxe') || i.name.includes('axe') || i.name.includes('shovel')
                    );
                    if (tool) await bot.equip(tool, 'hand');
                }
            } catch (e) {
                console.warn('⚠️ Falha ao equipar ferramenta:', e.message);
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

function showStatus(bot) {
    const pos = bot.entity.position;
    sendMessage(bot, `📍 Posição: X:${pos.x.toFixed(1)} Y:${pos.y.toFixed(1)} Z:${pos.z.toFixed(1)} | Mineração: ${isMining ? 'Ativa' : 'Inativa'}`);
}

function handleChat(bot, username, message) {
    if (username === bot.username) return;

    const args = message.split(' ');
    const command = args[0].toLowerCase();

    switch (command) {
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
    handleChat,
    startMining,
    stopMining,
    followPlayer,
    showStatus
};
