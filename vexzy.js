require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// LUA ENGINE
const fengari = require('fengari');
const lua = fengari.lua;
const lauxlib = fengari.lauxlib;
const lualib = fengari.lualib;
const to_js = fengari.to_jsstring;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const PREFIX = '.l';

// ================= BASIC DECODE =================
function basicDecode(code) {
  let r = code;

  r = r.replace(/\\(\d{3})/g, (_, d) =>
    String.fromCharCode(parseInt(d, 8))
  );

  r = r.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );

  return r;
}

// ================= LUA EXECUTION =================
function runLua(code) {
  let captured = [];

  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  // hook print
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

  // hook loadstring (recursive)
  lua.lua_pushcfunction(L, function(L) {
    const str = to_js(lua.lua_tostring(L, 1));
    captured.push(str);

    try {
      lauxlib.luaL_dostring(L, str);
    } catch {}

    lua.lua_pushcfunction(L, () => 0);
    return 1;
  });
  lua.lua_setglobal(L, "loadstring");

  try {
    lauxlib.luaL_dostring(L, `
      local f = ${code}
      if type(f) == "function" then
        for i=1,5 do
          pcall(f, {}, {}, {}, {}, {})
        end
      end
    `);
  } catch {}

  return captured.join('\n') || code;
}

// ================= Z TABLE EXTRACTION =================
function extractZ(code) {
  const match = code.match(/local\\s+Z\\s*=\\s*\\{([\\s\\S]*?)\\}/);
  if (!match) return code;

  let raw = match[1];
  let strings = [];
  let m;

  const regex = /"([^"]*)"/g;
  while ((m = regex.exec(raw)) !== null) {
    strings.push(m[1]);
  }

  return strings.join('');
}

// ================= PIPELINE =================
async function deobf(code) {
  let prev;

  for (let i = 0; i < 10; i++) {
    prev = code;

    // step 1 decode basic
    code = basicDecode(code);

    // step 2 force lua execution
    const runtime = runLua(code);
    if (runtime !== code && runtime.length > 20) {
      code = runtime;
    }

    // step 3 fallback: extract Z
    const z = extractZ(code);
    if (z !== code && z.length > 20) {
      code = z;
    }

    code = code.replace(/[\\x00-\\x1F]/g, '');

    if (code === prev) break;
  }

  return code;
}

// ================= FETCH =================
async function fetchFromURL(url) {
  const res = await axios.get(url, { responseType: 'text' });
  return res.data;
}

// ================= BOT =================
client.once('ready', () => {
  console.log(`✅ Ready: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);

  let code = null;
  let source = '';

  const att = message.attachments.first();

  if (att) {
    const ext = path.extname(att.name).toLowerCase();
    if (!['.lua', '.txt', '.luau'].includes(ext)) {
      return message.reply('❌ file gak support');
    }

    source = `📎 ${att.name}`;
    const res = await axios.get(att.url);
    code = res.data;
  }

  if (!code && args.length > 0) {
    if (args[0].startsWith('http')) {
      source = '🔗 URL';
      code = await fetchFromURL(args[0]);
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
    const result = await deobf(code);

    const embed = new EmbedBuilder()
      .setTitle('📄 Deobf Result (WAD HARD)')
      .setColor(0x00ff00)
      .addFields({ name: 'Source', value: source });

    if (result.length > 1900) {
      const name = `deobf_${Date.now()}.lua`;
      fs.writeFileSync(name, result);
      await message.reply({ embeds: [embed], files: [name] });
      fs.unlinkSync(name);
    } else {
      embed.setDescription(`\`\`\`lua\n${result.substring(0, 3800)}\n\`\`\``);
      await message.reply({ embeds: [embed] });
    }

  } catch (e) {
    message.reply(`❌ Error: ${e.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
