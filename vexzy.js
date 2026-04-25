require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// === LUA RUNTIME (FENGARI) ===
const fengari = require('fengari');
const lua = fengari.lua;
const lauxlib = fengari.lauxlib;
const lualib = fengari.lualib;
const to_js = fengari.to_jsstring;

// === DISCORD ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const PREFIX = '.l';

// ================= WAD BASIC DECODE =================
function wadBasicDecode(code) {
  try {
    let r = code;

    // octal \123
    r = r.replace(/\\(\d{3})/g, (_, d) =>
      String.fromCharCode(parseInt(d, 8))
    );

    // hex \x41
    r = r.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );

    // loadstring(decode("..."))
    const m = r.match(/loadstring\s*\(\s*decode\s*\(\s*["']([^"']+)["']\s*\)\s*\)/);
    if (m) {
      try {
        return Buffer.from(m[1], 'base64').toString();
      } catch {}
    }

    // fallback base64 panjang
    const b64 = r.match(/["']([A-Za-z0-9+/=]{80,})["']/);
    if (b64) {
      try {
        return Buffer.from(b64[1], 'base64').toString();
      } catch {}
    }

    return r;
  } catch {
    return code;
  }
}

// ================= LUA EXECUTION + HOOK =================
function runLuaAndCapture(code) {
  let captured = [];

  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  // override print
  lua.lua_pushcfunction(L, function(L) {
    const n = lua.lua_gettop(L);
    let out = [];
    for (let i = 1; i <= n; i++) {
      out.push(to_js(lua.lua_tostring(L, i)));
    }
    captured.push(out.join(' '));
    return 0;
  });
  lua.lua_setglobal(L, "print");

  // override loadstring
  lua.lua_pushcfunction(L, function(L) {
    const str = to_js(lua.lua_tostring(L, 1));
    captured.push(str);
    // return dummy function
    lua.lua_pushcfunction(L, () => 0);
    return 1;
  });
  lua.lua_setglobal(L, "loadstring");

  try {
    lauxlib.luaL_dostring(L, code);
  } catch (e) {
    // error normal, kita cuma butuh side-effect
  }

  return captured.join('\n') || code;
}

// ================= PIPELINE =================
async function deobfWAD(code) {
  let prev;

  for (let i = 0; i < 6; i++) {
    prev = code;

    // layer 1: decode luar
    code = wadBasicDecode(code);

    // layer 2: paksa execute decoder Lua
    const runtime = runLuaAndCapture(code);
    if (runtime && runtime !== code && runtime.length > 20) {
      code = runtime;
    }

    // bersihin control char
    code = code.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

    if (code === prev) break;
  }

  return code;
}

// ================= FETCH =================
async function fetchFromURL(url) {
  const res = await axios.get(url, { responseType: 'text', timeout: 15000 });
  return res.data;
}

// ================= READY =================
client.once('ready', () => {
  console.log(`✅ Ready sebagai ${client.user.tag}`);
});

// ================= COMMAND `.l` =================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);

  let code = null;
  let source = '';

  const attachment = message.attachments.first();

  // file
  if (attachment) {
    const ext = path.extname(attachment.name).toLowerCase();
    if (!['.lua', '.txt', '.luau'].includes(ext)) {
      return message.reply('❌ File tidak didukung.');
    }

    source = `📎 ${attachment.name}`;
    const res = await axios.get(attachment.url);
    code = res.data;
  }

  // url / text
  if (!code && args.length > 0) {
    if (args[0].startsWith('http')) {
      source = '🔗 URL';
      try {
        code = await fetchFromURL(args[0]);
      } catch {
        return message.reply('❌ Gagal fetch URL');
      }
    } else {
      source = '📝 Direct';
      code = args.join(' ');
    }
  }

  if (!code) {
    return message.reply(`❌ Usage: \`${PREFIX} <file/url/code>\``);
  }

  await message.channel.sendTyping();

  try {
    const start = Date.now();
    const result = await deobfWAD(code);
    const time = Date.now() - start;

    const embed = new EmbedBuilder()
      .setTitle('📄 WAD Deobf Result')
      .setColor(0x00ff00)
      .addFields(
        { name: 'Source', value: source },
        { name: 'Time', value: `${time}ms`, inline: true }
      );

    if (result.length > 1900) {
      const fileName = `deobf_${Date.now()}.lua`;
      fs.writeFileSync(fileName, result);
      await message.reply({ embeds: [embed], files: [fileName] });
      fs.unlinkSync(fileName);
    } else {
      embed.setDescription(`\`\`\`lua\n${result.substring(0, 3800)}\n\`\`\``);
      await message.reply({ embeds: [embed] });
    }

  } catch (err) {
    message.reply(`❌ Error: ${err.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
