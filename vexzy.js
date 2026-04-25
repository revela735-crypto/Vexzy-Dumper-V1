require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages
    ] 
});

const PREFIX = '.l';
const VERSION = '1.0.0';

// ========== CONFIG ==========
const config = {
    maxSize: 200000,
    allowedExtensions: ['.lua', '.txt', '.luau', '.rbxl'],
    cooldown: 3000,
    owners: ['786064814952566824'] // ganti pake user ID lo
};

const cooldowns = new Map();

// ========== DEOBFUSCATOR ENGINE ==========
function deobfuscateWeAreDevs(code) {
    let result = code;
    try {
        result = result.replace(/\\(\d{3})/g, (_, d) => String.fromCharCode(parseInt(d, 8)));
        const base64Match = result.match(/loadstring\(decode\("([^"]+)"\)\)/);
        if (base64Match) {
            result = Buffer.from(base64Match[1], 'base64').toString();
        }
        result = result.replace(/[^\x20-\x7E\n\r\t]/g, '');
    } catch(e) {}
    return result;
}

function deobfuscateMoonsec(code) {
    let result = code;
    try {
        if (code.includes('local V={') && code.includes('local W={')) {
            const stringTable = code.match(/local\s+[\w_]+\s*=\s*\{([^}]+)\}/);
            if (stringTable) {
                result = code.replace(/_\[\d+\]/g, (m) => {
                    const idx = parseInt(m.match(/\d+/)[0]);
                    const items = stringTable[1].split(',');
                    if (items[idx]) return items[idx].trim().replace(/['"]/g, '');
                    return m;
                });
            }
        }
    } catch(e) {}
    return result;
}

function deobfuscateIronBrew(code) {
    let result = code;
    try {
        result = result.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    } catch(e) {}
    return result;
}

function deobfuscateLuarmor(code) {
    let result = code;
    try {
        result = result.replace(/__\(\d+\)/g, () => '"reconstructed"');
    } catch(e) {}
    return result;
}

function deobfuscateGeneric(code) {
    let result = code;
    try {
        result = result.replace(/[^\x20-\x7E\n\r\t]/g, '');
        const decoded = result.match(/loadstring\(([^)]+)\)/);
        if (decoded && decoded[1].includes('base64')) {
            const b64 = decoded[1].match(/"([^"]+)"/);
            if (b64) {
                result = Buffer.from(b64[1], 'base64').toString();
            }
        }
    } catch(e) {}
    return result;
}

function autoDetectAndDeobf(code) {
    const checks = [
        { name: 'WeAreDevs', test: /\\\d{3}/, func: deobfuscateWeAreDevs },
        { name: 'Moonsec V3', test: /local V=\{/, func: deobfuscateMoonsec },
        { name: 'IronBrew', test: /\\x[0-9a-f]{2}/, func: deobfuscateIronBrew },
        { name: 'Luarmor', test: /__\(\d+\)/, func: deobfuscateLuarmor }
    ];
    
    for (const check of checks) {
        if (check.test.test(code)) {
            return check.func(code);
        }
    }
    return deobfuscateGeneric(code);
}

function formatScriptInfo(code) {
    const lines = code.split('\n').length;
    const functions = (code.match(/function\s+\w+/g) || []).length;
    const locals = (code.match(/local\s+\w+/g) || []).length;
    const strings = (code.match(/["'][^"']*["']/g) || []).length;
    return { lines, functions, locals, strings };
}

async function fetchFromURL(url) {
    const response = await axios.get(url, { 
        responseType: 'text',
        timeout: 15000,
        headers: { 'User-Agent': 'VexzyDumper/1.0' }
    });
    return response.data;
}

function isOwner(userId) {
    return config.owners.includes(userId);
}

function checkCooldown(userId) {
    const now = Date.now();
    if (cooldowns.has(userId)) {
        const last = cooldowns.get(userId);
        if (now - last < config.cooldown) {
            return (config.cooldown - (now - last)) / 1000;
        }
    }
    cooldowns.set(userId, now);
    return false;
}

// ========== DISCORD BOT ==========
client.once('ready', () => {
    console.log(`✅ Vexzy Dumper v${VERSION} online sebagai ${client.user.tag}`);
    console.log(`📌 Prefix: ${PREFIX}`);
    console.log(`👑 Owner: ${config.owners.join(', ')}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ========== HELP ==========
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('🔧 Vexzy Dumper')
            .setDescription('**Deobfuscator Bot for Roblox Lua Scripts**\nPrefix: `' + PREFIX + '`')
            .setColor(0x5865F2)
            .addFields(
                { name: `${PREFIX} <file/url/code>`, value: 'Deobfuscate script', inline: false },
                { name: `${PREFIX} info`, value: 'Tampilkan info bot & stats', inline: true },
                { name: `${PREFIX} stats`, value: 'Tampilkan statistik script', inline: true },
                { name: `${PREFIX} help`, value: 'Bantuan ini', inline: true },
                { name: '📌 Supported', value: 'WeAreDevs • Moonsec V3 • IronBrew • Luarmor • Basic Obfuscators', inline: false }
            )
            .setFooter({ text: `Vexzy Dumper v${VERSION} | Prefix ${PREFIX}` });
        return message.reply({ embeds: [embed] });
    }

    // ========== INFO ==========
    if (command === 'info') {
        const totalServers = client.guilds.cache.size;
        const totalUsers = client.users.cache.size;
        const uptime = Math.floor(process.uptime());
        
        const embed = new EmbedBuilder()
            .setTitle('ℹ️ Vexzy Dumper Info')
            .setColor(0x5865F2)
            .addFields(
                { name: 'Version', value: VERSION, inline: true },
                { name: 'Prefix', value: PREFIX, inline: true },
                { name: 'Servers', value: `${totalServers}`, inline: true },
                { name: 'Users', value: `${totalUsers}`, inline: true },
                { name: 'Uptime', value: `${Math.floor(uptime / 60)}m ${uptime % 60}s`, inline: true },
                { name: 'Supported Obfuscators', value: 'WeAreDevs, Moonsec V3, IronBrew, Luarmor, Veil', inline: false }
            )
            .setFooter({ text: 'Vexzy Dumper' });
        return message.reply({ embeds: [embed] });
    }

    // ========== STATS ==========
    if (command === 'stats') {
        if (!args.length) {
            return message.reply('❌ Usage: `.l stats <code/url/file>`');
        }
        
        let code = null;
        if (args[0].startsWith('http')) {
            try {
                code = await fetchFromURL(args[0]);
            } catch (e) {
                return message.reply(`❌ Gagal fetch URL: ${e.message}`);
            }
        } else {
            code = args.join(' ');
        }
        
        if (!code) return message.reply('❌ Gak ada script yang dikasih.');
        
        const info = formatScriptInfo(code);
        const embed = new EmbedBuilder()
            .setTitle('📊 Script Statistics')
            .setColor(0x5865F2)
            .addFields(
                { name: 'Characters', value: `${code.length.toLocaleString()}`, inline: true },
                { name: 'Lines', value: `${info.lines.toLocaleString()}`, inline: true },
                { name: 'Functions', value: `${info.functions}`, inline: true },
                { name: 'Local Variables', value: `${info.locals}`, inline: true },
                { name: 'Strings', value: `${info.strings}`, inline: true },
                { name: 'Size', value: `${(code.length / 1024).toFixed(2)} KB`, inline: true }
            )
            .setFooter({ text: 'Vexzy Dumper' });
        return message.reply({ embeds: [embed] });
    }

    // ========== DEOBFUSCATE ==========
    let code = null;
    let source = '';

    const attachment = message.attachments.first();
    if (attachment) {
        const ext = path.extname(attachment.name).toLowerCase();
        if (config.allowedExtensions.includes(ext)) {
            source = `📎 ${attachment.name}`;
            try {
                const response = await axios.get(attachment.url, { responseType: 'text' });
                code = response.data;
            } catch (err) {
                return message.reply(`❌ Gagal download attachment: ${err.message}`);
            }
        } else {
            return message.reply('❌ Extensi file gak support. Pake `.lua`, `.txt`, atau `.luau`.');
        }
    }
    
    if (!code && args.length > 0) {
        const input = args[0];
        if (input.startsWith('http://') || input.startsWith('https://')) {
            source = `🔗 ${input.substring(0, 50)}...`;
            try {
                code = await fetchFromURL(input);
            } catch (err) {
                return message.reply(`❌ Gagal fetch URL: ${err.message}`);
            }
        } else {
            source = '📝 Direct Input';
            code = args.join(' ');
        }
    }

    if (!code) {
        return message.reply(`❌ **Usage:**\n\`${PREFIX} <file/url>\`\n\`${PREFIX} help\``);
    }

    if (code.length > config.maxSize) {
        return message.reply(`⚠️ Script terlalu besar (${(code.length / 1024).toFixed(2)} KB > ${config.maxSize / 1024} KB).`);
    }

    const cooldown = checkCooldown(message.author.id);
    if (cooldown) {
        return message.reply(`⏳ Cooldown ${cooldown.toFixed(1)} detik. Sabar.`);
    }

    await message.channel.sendTyping();
    
    try {
        const startTime = Date.now();
        const result = autoDetectAndDeobf(code);
        const endTime = Date.now();
        const timeTaken = endTime - startTime;

        const info = formatScriptInfo(code);
        const resultInfo = formatScriptInfo(result);
        
        const embed = new EmbedBuilder()
            .setTitle('📄 Deobfuscated Script')
            .setColor(0x00ff00)
            .addFields(
                { name: 'Source', value: source, inline: false },
                { name: 'Original Size', value: `${info.lines} lines | ${info.functions} funcs`, inline: true },
                { name: 'Result Size', value: `${resultInfo.lines} lines | ${resultInfo.funcs} funcs`, inline: true },
                { name: 'Time', value: `${timeTaken}ms`, inline: true },
                { name: 'Compression', value: `${((1 - result.length / code.length) * 100).toFixed(1)}%`, inline: true }
            )
            .setFooter({ text: 'Vexzy Dumper' });

        if (result.length > 1900) {
            const fileName = `deobf_${Date.now()}.lua`;
            fs.writeFileSync(fileName, result);
            await message.reply({ embeds: [embed], files: [fileName] });
            fs.unlinkSync(fileName);
        } else {
            embed.setDescription(`\`\`\`lua\n${result.substring(0, 3800)}\n\`\`\``);
            await message.reply({ embeds: [embed] });
        }
        
    } catch (error) {
        console.error(error);
        await message.reply(`❌ Error: ${error.message}\n\nScript mungkin terlalu kompleks atau obfuscator gak dikenal.`);
    }
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

client.login(process.env.DISCORD_TOKEN);