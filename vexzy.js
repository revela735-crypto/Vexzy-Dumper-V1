require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { exec } = require('child_process');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages
    ] 
});

const PREFIX = '.l';
const VERSION = '2.0.0';

// ========== CONFIG ==========
const config = {
    maxSize: 500000,
    allowedExtensions: ['.lua', '.txt', '.luau', '.rbxl'],
    cooldown: 3000,
    owners: ['786064814952566824']
};

const cooldowns = new Map();

// ========== DEOBFUSCATOR ENGINE ==========

// 1. WeAreDevs Obfuscator
function deobfuscateWeAreDevs(code) {
    let result = code;
    try {
        // Decode octal escape sequences (\xxx)
        result = result.replace(/\\(\d{3})/g, (_, d) => String.fromCharCode(parseInt(d, 8)));
        
        // Extract Base64 payload from loadstring(decode("..."))
        const match = result.match(/loadstring\(decode\("([^"]+)"\)\)/);
        if (match) {
            return Buffer.from(match[1], 'base64').toString();
        }
        const altMatch = result.match(/loadstring\(decode\('([^']+)'\)\)/);
        if (altMatch) {
            return Buffer.from(altMatch[1], 'base64').toString();
        }
        return result;
    } catch(e) {
        return "Deobf error: " + e.message;
    }
}

// 2. Moonsec V3 Obfuscator
function deobfuscateMoonsec(code) {
    try {
        // Moonsec V3 structure: local V={...} local W={...}
        if (!code.includes('local V={') || !code.includes('local W={')) return code;
        
        // Extract string table
        const stringTableMatch = code.match(/local\s+V\s*=\s*\{([^}]+)\}/);
        if (!stringTableMatch) return code;
        
        const strings = stringTableMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
        
        // Replace all _[index] with actual strings
        let result = code.replace(/_\[(\d+)\]/g, (_, idx) => {
            const i = parseInt(idx);
            return strings[i] || `_${idx}`;
        });
        
        // Clean up VM debris
        result = result.replace(/local\s+[\w_]+\s*=\s*\{[^}]*\}\s*/, '');
        result = result.replace(/local\s+[\w_]+\s*=\s*function\([^)]*\)[\s\S]*?return\s+[\w_]+[\s\S]*?end/, '');
        
        return result;
    } catch(e) {
        return code;
    }
}

// 3. IronBrew Obfuscator
function deobfuscateIronBrew(code) {
    try {
        let result = code;
        
        // Decode hex escape sequences (\xXX)
        result = result.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        
        // Decode Base64 payload
        const b64Match = result.match(/loadstring\(\s*decode\s*\(\s*"([^"]+)"\s*\)\s*\)/);
        if (b64Match) {
            return Buffer.from(b64Match[1], 'base64').toString();
        }
        
        // IronBrew often has __index lookups
        const indexMatch = result.match(/__index\s*=\s*function\([^,]*,\s*([^)]+)\)/);
        
        return result;
    } catch(e) {
        return code;
    }
}

// 4. Luarmor Obfuscator
function deobfuscateLuarmor(code) {
    try {
        let result = code;
        
        // Replace __(number) with reconstructed strings
        const stringTableMatch = code.match(/local\s+str\s*=\s*\{([^}]+)\}/);
        if (stringTableMatch) {
            const strings = stringTableMatch[1].split(',').map(s => s.match(/"([^"]+)"/)?.[1] || '').filter(Boolean);
            result = result.replace(/__\((\d+)\)/g, (_, idx) => {
                const i = parseInt(idx);
                return strings[i] || `__${idx}`;
            });
        }
        
        // Remove __index junk
        result = result.replace(/__index\s*=\s*function\([^)]*\)[\s\S]*?end/, '');
        
        return result;
    } catch(e) {
        return code;
    }
}

// 5. Luraph v14.7 Obfuscator (via Python tool or API)
async function deobfuscateLuraph(code) {
    try {
        // Method 1: Try to extract payload and decode base85
        const payloadMatch = code.match(/\[\=\[(.*?)\]\=\]/s);
        if (payloadMatch) {
            // This is the base85 payload, need proper decoding
            // For now, fallback to API or Python
            return await callLuraphDeobfAPI(code);
        }
        
        // Method 2: Luraph has signature "return(function(...)local V={"
        if (code.includes('return(function(...)local V={') && code.includes('lura.ph')) {
            return await callLuraphDeobfAPI(code);
        }
        
        return code;
    } catch(e) {
        return "Luraph deobf failed: " + e.message;
    }
}

// Helper: Call external Luraph deobfuscator
async function callLuraphDeobfAPI(code) {
    // Try free API (if available)
    try {
        const response = await axios.post('https://luraph-deobfuscator-api.vercel.app/deobf', {
            script: code.substring(0, 50000)
        }, { timeout: 30000 });
        if (response.data && response.data.deobfuscated) {
            return response.data.deobfuscated;
        }
    } catch(e) {
        // Fallback: return error message with sample
        return "Luraph v14.7 deobfuscation requires local Python tool. First 500 chars:\n" + code.substring(0, 500);
    }
    
    return "Luraph v14.7 too complex for online deobf. Use local Python tool.";
}

// Universal auto-detection
async function autoDetectAndDeobf(code) {
    // WeAreDevs
    if (code.includes('\\') && (code.includes('loadstring') || code.includes('decode'))) {
        return deobfuscateWeAreDevs(code);
    }
    
    // Moonsec V3
    if (code.includes('local V={') && code.includes('local W={')) {
        return deobfuscateMoonsec(code);
    }
    
    // IronBrew
    if (code.includes('\\x') && code.includes('loadstring')) {
        return deobfuscateIronBrew(code);
    }
    
    // Luarmor
    if (code.includes('__(') && code.includes('str = {')) {
        return deobfuscateLuarmor(code);
    }
    
    // Luraph v14.7
    if (code.includes('return(function(...)local V={') || code.includes('lura.ph')) {
        return await deobfuscateLuraph(code);
    }
    
    // Fallback: clean null bytes
    return code.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// Format script info
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
        headers: { 'User-Agent': 'VexzyDumper/2.0' }
    });
    return response.data;
}

function isOwner(userId) { return config.owners.includes(userId); }

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

    // Help command
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('🔧 Vexzy Dumper v2.0')
            .setDescription('**Deobfuscator Bot for Roblox Lua Scripts**\nPrefix: `' + PREFIX + '`')
            .setColor(0x5865F2)
            .addFields(
                { name: `${PREFIX} <file/url/code>`, value: 'Deobfuscate script (auto-detect)', inline: false },
                { name: `${PREFIX} stats <code/url/file>`, value: 'Show script statistics', inline: true },
                { name: `${PREFIX} info`, value: 'Bot info', inline: true },
                { name: '📌 Supported', value: 'WeAreDevs, Moonsec V3, IronBrew, Luarmor, Luraph v14.7', inline: false }
            )
            .setFooter({ text: `Vexzy Dumper v${VERSION}` });
        return message.reply({ embeds: [embed] });
    }

    // Info command
    if (command === 'info') {
        const totalServers = client.guilds.cache.size;
        const uptime = Math.floor(process.uptime());
        const embed = new EmbedBuilder()
            .setTitle('ℹ️ Vexzy Dumper Info')
            .setColor(0x5865F2)
            .addFields(
                { name: 'Version', value: VERSION, inline: true },
                { name: 'Prefix', value: PREFIX, inline: true },
                { name: 'Servers', value: `${totalServers}`, inline: true },
                { name: 'Uptime', value: `${Math.floor(uptime / 60)}m ${uptime % 60}s`, inline: true },
                { name: 'Supported Obfuscators', value: 'WeAreDevs, Moonsec V3, IronBrew, Luarmor, Luraph v14.7', inline: false }
            )
            .setFooter({ text: 'Vexzy Dumper' });
        return message.reply({ embeds: [embed] });
    }

    // Stats command
    if (command === 'stats') {
        if (!args.length) return message.reply('❌ Usage: `.l stats <code/url/file>`');
        
        let code = null;
        if (args[0].startsWith('http')) {
            try { code = await fetchFromURL(args[0]); } 
            catch(e) { return message.reply(`❌ Gagal fetch URL: ${e.message}`); }
        } else {
            code = args.join(' ');
        }
        
        const info = formatScriptInfo(code);
        const embed = new EmbedBuilder()
            .setTitle('📊 Script Statistics')
            .setColor(0x5865F2)
            .addFields(
                { name: 'Characters', value: `${code.length.toLocaleString()}`, inline: true },
                { name: 'Lines', value: `${info.lines.toLocaleString()}`, inline: true },
                { name: 'Functions', value: `${info.functions}`, inline: true },
                { name: 'Local Vars', value: `${info.locals}`, inline: true },
                { name: 'Size', value: `${(code.length / 1024).toFixed(2)} KB`, inline: true }
            );
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
        if (input.startsWith('http')) {
            source = `🔗 ${input.substring(0, 50)}...`;
            try { code = await fetchFromURL(input); } 
            catch (err) { return message.reply(`❌ Gagal fetch URL: ${err.message}`); }
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
    if (cooldown) return message.reply(`⏳ Cooldown ${cooldown.toFixed(1)} detik.`);

    await message.channel.sendTyping();
    
    try {
        const startTime = Date.now();
        const result = await autoDetectAndDeobf(code);
        const endTime = Date.now();
        const timeTaken = endTime - startTime;

        const embed = new EmbedBuilder()
            .setTitle('📄 Deobfuscated Script')
            .setColor(0x00ff00)
            .addFields(
                { name: 'Source', value: source, inline: false },
                { name: 'Original Size', value: `${(code.length / 1024).toFixed(2)} KB`, inline: true },
                { name: 'Result Size', value: `${(result.length / 1024).toFixed(2)} KB`, inline: true },
                { name: 'Time', value: `${timeTaken}ms`, inline: true }
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
        await message.reply(`❌ Error: ${error.message}\n\nScript mungkin terlalu kompleks atau obfuscator tidak dikenal.`);
    }
});

process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
client.login(process.env.DISCORD_TOKEN);
