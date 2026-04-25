import discord
from discord.ext import commands
import aiohttp
import io
import json
import hashlib
import secrets
import random
import time

# --- KONFIGURASI ---
TOKEN = 'YOUR_BOT_TOKEN_HERE'
API_DEOBF = "http://relua.lua.cz/deobfuscate"

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix='!', intents=intents)

async def send_as_file(ctx, content, filename, message=""):
    """Fungsi helper untuk mengirim teks panjang sebagai file .txt"""
    with io.BytesIO(content.encode('utf-8')) as file_out:
        await ctx.send(content=message, file=discord.File(file_out, filename=filename))

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user.name}')

@bot.command()
async def deobf(ctx):
    target_msg = ctx.message

    # 1. Cek apakah ini reply ke pesan yang punya file
    if ctx.message.reference:
        target_msg = await ctx.channel.fetch_message(ctx.message.reference.message_id)

    # 2. Ambil attachment (dari pesan ini atau pesan yang di-reply)
    if not target_msg.attachments:
        return await ctx.send("❌ Lampirkan file .lua/.txt atau reply pesan yang berisi file!")

    attachment = target_msg.attachments[0]
    if not (attachment.filename.endswith('.lua') or attachment.filename.endswith('.txt')):
        return await ctx.send("❌ Hanya mendukung file .lua atau .txt")

    # Proses cepat dengan session
    async with aiohttp.ClientSession() as session:
        async with session.get(attachment.url) as resp:
            lua_source = await resp.text()

        payload = {
            "filename": attachment.filename,
            "source": lua_source,
            "lua_version": "Lua51",
            "pretty": True
        }

        async with session.post(API_DEOBF, json=payload) as api_resp:
            data = await api_resp.json()
            
            if data.get('ok'):
                # Kirim hasil deobfuscate balik ke .txt
                await send_as_file(ctx, data.get('output'), "deobfuscated_result.txt", "✅ **Done!**")
            else:
                await ctx.send(f"❌ API Error: {data.get('error', 'Unknown error')}")

@bot.command()
async def get(ctx, url: str = None):
    if not url:
        return await ctx.send("❌ Masukkan URL! Contoh: `!get https://link-raw.com`")

    # Header khusus sesuai permintaanmu
    m_id = hashlib.sha256(str(random.getrandbits(256)).encode()).hexdigest()[:32]
    p_token = f"WINPLAYER_{secrets.token_hex(32)}"
    
    headers = {
        "User-Agent": "Roblox/WinInet",
        "Accept": "*/*",
        "Roblox-Place-Id": "0",
        "Roblox-Machine-Id": m_id,
        "Roblox-Client-Version": "version-b5d5c1c7b5d5c1c7",
        "Roblox-Client-App": "WindowsPlayer",
        "Roblox-Client-OS": "Windows 10",
        "Roblox-Place-Launch-Time": str(int(time.time())),
        "Roblox-Player-Token": p_token,
        "Roblox-Script-Hash": hashlib.sha256(b"monlua").hexdigest(),
        "X-CSRF-TOKEN": secrets.token_hex(32),
        "Requester": "Client",
        "Connection": "keep-alive"
    }

    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(url, headers=headers, timeout=12) as resp:
                content = await resp.text()
                if resp.status == 200:
                    await send_as_file(ctx, content, "raw_content.txt", f"📦 **Status 200 OK**")
                else:
                    await ctx.send(f"❌ Failed! HTTP Status: {resp.status}")
        except Exception as e:
            await ctx.send(f"⚠️ Connection Error: {str(e)}")

bot.run(TOKEN)
