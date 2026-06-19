const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, getVoiceConnection } = require('@discordjs/voice');
const play = require('play-dl');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static('public'));

let bot = null;
let botStatus = 'offline';
let logs = [];
let botToken = '';

// ======== QUEUE SYSTEM ========
const queues = new Map(); // guildId -> { songs: [], current: 0, connection: null, player: null }

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      songs: [],
      current: 0,
      connection: null,
      player: null,
      loop: false
    });
  }
  return queues.get(guildId);
}

function addLog(msg) {
  const time = new Date().toLocaleTimeString('ar-SA');
  const log = `[${time}] ${msg}`;
  logs.push(log);
  if (logs.length > 100) logs.shift();

  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'log', message: log }));
    }
  });
}

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'status', status: botStatus }));
  logs.forEach(log => ws.send(JSON.stringify({ type: 'log', message: log })));
});

// ======== MUSIC FUNCTIONS ========

async function searchSoundCloud(query) {
  try {
    // SoundCloud search via play-dl
    const results = await play.search(query, { limit: 5, source: { soundcloud: 'tracks' } });
    return results;
  } catch (err) {
    addLog(`❌ SoundCloud error: ${err.message}`);
    return [];
  }
}

async function searchSpotify(query) {
  try {
    const results = await play.search(query, { limit: 5, source: { spotify: 'tracks' } });
    return results;
  } catch (err) {
    addLog(`❌ Spotify error: ${err.message}`);
    return [];
  }
}

async function getStream(url) {
  try {
    const stream = await play.stream(url);
    return stream;
  } catch (err) {
    addLog(`❌ Stream error: ${err.message}`);
    return null;
  }
}

function createPlayer(guildId) {
  const queue = getQueue(guildId);
  const player = createAudioPlayer();

  player.on(AudioPlayerStatus.Idle, () => {
    if (queue.loop) {
      playSong(guildId, queue.current);
    } else {
      queue.current++;
      if (queue.current < queue.songs.length) {
        playSong(guildId, queue.current);
      } else {
        queue.current = 0;
        addLog(`⏹️ Queue finished in guild ${guildId}`);
      }
    }
  });

  player.on('error', (err) => {
    addLog(`❌ Player error: ${err.message}`);
    queue.current++;
    if (queue.current < queue.songs.length) {
      playSong(guildId, queue.current);
    }
  });

  queue.player = player;
  return player;
}

async function playSong(guildId, index) {
  const queue = getQueue(guildId);
  if (!queue.songs[index]) return;

  const song = queue.songs[index];
  addLog(`▶️ Playing: ${song.title}`);

  const stream = await getStream(song.url);
  if (!stream) {
    addLog(`❌ Failed to stream: ${song.title}`);
    return;
  }

  const resource = createAudioResource(stream.stream, { inputType: stream.type });
  
  if (!queue.player) {
    createPlayer(guildId);
  }

  queue.player.play(resource);

  if (queue.connection) {
    queue.connection.subscribe(queue.player);
  }
}

// ======== COMMANDS ========

function setupCommands() {
  bot.commands = new Collection();

  // Play command
  bot.commands.set('play', {
    name: 'play',
    aliases: ['شغل', 'p'],
    description: 'يشغل موسيقى من SoundCloud/Spotify',
    async execute(message, args) {
      const query = args.join(' ');
      if (!query) return message.reply('❌ اكتب اسم الأغنية أو الرابط!');

      const voiceChannel = message.member.voice.channel;
      if (!voiceChannel) return message.reply('❌ ادخل روم صوتي الأول!');

      const queue = getQueue(message.guild.id);

      // Join voice channel
      if (!queue.connection) {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false
        });
        queue.connection = connection;
      }

      message.channel.send(`🔍 جاري البحث عن: **${query}**...`);

      // Search SoundCloud first
      let results = await searchSoundCloud(query);
      let source = 'SoundCloud';

      // Fallback to Spotify
      if (!results || results.length === 0) {
        results = await searchSpotify(query);
        source = 'Spotify';
      }

      if (!results || results.length === 0) {
        return message.reply('❌ ما لقيت شي! جرب اسم ثاني.');
      }

      const song = results[0];
      const songData = {
        title: song.name || song.title,
        url: song.url,
        duration: song.durationInSec || 0,
        thumbnail: song.thumbnail?.url || null,
        artist: song.artists?.[0]?.name || 'Unknown',
        source: source,
        requestedBy: message.author.tag
      };

      queue.songs.push(songData);

      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('🎵 أضيفت للقائمة')
        .setDescription(`**${songData.title}**`)
        .addFields(
          { name: 'الفنان', value: songData.artist, inline: true },
          { name: 'المدة', value: `${Math.floor(songData.duration / 60)}:${(songData.duration % 60).toString().padStart(2, '0')}`, inline: true },
          { name: 'المصدر', value: source, inline: true },
          { name: 'طلبها', value: message.author.toString(), inline: true }
        )
        .setThumbnail(songData.thumbnail || message.author.displayAvatarURL());

      message.channel.send({ embeds: [embed] });

      // Play if first song
      if (queue.songs.length === 1) {
        await playSong(message.guild.id, 0);
      }
    }
  });

  // Skip command
  bot.commands.set('skip', {
    name: 'skip',
    aliases: ['تخطي', 's'],
    description: 'يتخطى الأغنية الحالية',
    execute(message) {
      const queue = getQueue(message.guild.id);
      if (!queue.player) return message.reply('❌ ما في شي شغال!');

      queue.current++;
      if (queue.current < queue.songs.length) {
        playSong(message.guild.id, queue.current);
        message.reply(`⏭️ تخطيت! الأغنية الجاية: **${queue.songs[queue.current].title}**`);
      } else {
        queue.player.stop();
        queue.current = 0;
        message.reply('⏹️ خلصت القائمة!');
      }
    }
  });

  // Stop command
  bot.commands.set('stop', {
    name: 'stop',
    aliases: ['وقف', 'st'],
    description: 'يوقف الموسيقى ويفضي القائمة',
    execute(message) {
      const queue = getQueue(message.guild.id);
      if (queue.player) queue.player.stop();
      queue.songs = [];
      queue.current = 0;
      queue.loop = false;
      message.reply('⏹️ وقفت ومسحت القائمة!');
    }
  });

  // Queue command
  bot.commands.set('queue', {
    name: 'queue',
    aliases: ['قائمة', 'q'],
    description: 'يعرض قائمة الأغاني',
    execute(message) {
      const queue = getQueue(message.guild.id);
      if (!queue.songs.length) return message.reply('❌ القائمة فاضية!');

      const list = queue.songs.map((song, i) => {
        const current = i === queue.current ? '▶️' : `${i + 1}.`;
        return `${current} **${song.title}** - ${song.artist} (${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')})`;
      }).join('\n');

      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('🎵 قائمة الأغاني')
        .setDescription(list)
        .setFooter({ text: `${queue.songs.length} أغنية | Loop: ${queue.loop ? '✅' : '❌'}` });

      message.reply({ embeds: [embed] });
    }
  });

  // Loop command
  bot.commands.set('loop', {
    name: 'loop',
    aliases: ['تكرار', 'l'],
    description: 'يشغل/يطفي التكرار',
    execute(message) {
      const queue = getQueue(message.guild.id);
      queue.loop = !queue.loop;
      message.reply(`🔁 التكرار: ${queue.loop ? '**شغال**' : '**طافي**'}`);
    }
  });

  // Now Playing
  bot.commands.set('np', {
    name: 'np',
    aliases: ['الحين', 'now'],
    description: 'يعرض الأغنية الحالية',
    execute(message) {
      const queue = getQueue(message.guild.id);
      const song = queue.songs[queue.current];
      if (!song) return message.reply('❌ ما في شي شغال!');

      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('▶️ الأغنية الحالية')
        .setDescription(`**${song.title}**`)
        .addFields(
          { name: 'الفنان', value: song.artist, inline: true },
          { name: 'المصدر', value: song.source, inline: true },
          { name: 'طلبها', value: song.requestedBy, inline: true }
        )
        .setThumbnail(song.thumbnail || message.author.displayAvatarURL());

      message.reply({ embeds: [embed] });
    }
  });

  // Leave command
  bot.commands.set('leave', {
    name: 'leave',
    aliases: ['طل', 'اخرج', 'dc'],
    description: 'يخرج من الروم الصوتي',
    execute(message) {
      const queue = getQueue(message.guild.id);
      const connection = getVoiceConnection(message.guild.id);
      
      if (queue.player) queue.player.stop();
      if (connection) connection.destroy();
      
      queues.delete(message.guild.id);
      message.reply('👋 طلعت من الروم!');
    }
  });

  // Pause
  bot.commands.set('pause', {
    name: 'pause',
    aliases: ['وقف مؤقت', 'ps'],
    description: 'يوقف مؤقتاً',
    execute(message) {
      const queue = getQueue(message.guild.id);
      if (!queue.player) return message.reply('❌ ما في شي شغال!');
      queue.player.pause();
      message.reply('⏸️ وقفت مؤقتاً!');
    }
  });

  // Resume
  bot.commands.set('resume', {
    name: 'resume',
    aliases: ['كمل', 'rs'],
    description: 'يكمل الأغنية',
    execute(message) {
      const queue = getQueue(message.guild.id);
      if (!queue.player) return message.reply('❌ ما في شي شغال!');
      queue.player.unpause();
      message.reply('▶️ كملت!');
    }
  });

  // Volume (simulated - Discord.js voice doesn't have direct volume control)
  bot.commands.set('volume', {
    name: 'volume',
    aliases: ['صوت', 'vol'],
    description: 'يغير الصوت (1-100)',
    execute(message, args) {
      const vol = parseInt(args[0]);
      if (!vol || vol < 1 || vol > 100) return message.reply('❌ اكتب رقم من 1-100!');
      // Note: Real volume control needs ffmpeg volume filter
      message.reply(`🔊 مستوى الصوت: **${vol}%** (يتطلب إعدادات إضافية)`);
    }
  });

  // Help
  bot.commands.set('help', {
    name: 'help',
    aliases: ['مساعدة', 'h'],
    description: 'قائمة أوامر الموسيقى',
    execute(message) {
      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('🎵 أوامر الموسيقى')
        .setDescription('**المصادر:** SoundCloud, Spotify (بدون حماية YouTube)')
        .addFields(
          { name: '🎵 تشغيل', value: '`!play` / `!شغل` / `!p` + اسم الأغنية' },
          { name: '⏭️ تخطي', value: '`!skip` / `!تخطي` / `!s`' },
          { name: '⏹️ إيقاف', value: '`!stop` / `!وقف` / `!st`' },
          { name: '📜 قائمة', value: '`!queue` / `!قائمة` / `!q`' },
          { name: '🔁 تكرار', value: '`!loop` / `!تكرار` / `!l`' },
          { name: '▶️ الحين', value: '`!np` / `!الحين`' },
          { name: '⏸️ توقف مؤقت', value: '`!pause` / `!وقف مؤقت`' },
          { name: '▶️ كمل', value: '`!resume` / `!كمل`' },
          { name: '🔊 صوت', value: '`!volume` / `!صوت` + رقم' },
          { name: '👋 خروج', value: '`!leave` / `!طل` / `!dc`' }
        );

      message.reply({ embeds: [embed] });
    }
  });
}

// ======== EVENTS ========

function setupEvents() {
  bot.on('messageCreate', (message) => {
    if (message.author.bot || !message.guild) return;

    if (!message.content.startsWith('!')) return;
    
    const args = message.content.slice(1).trim().split(/ +/);
    let cmdName = args.shift().toLowerCase();

    // Check aliases
    const aliases = {
      'شغل': 'play', 'p': 'play',
      'تخطي': 'skip', 's': 'skip',
      'وقف': 'stop', 'st': 'stop',
      'قائمة': 'queue', 'q': 'queue',
      'تكرار': 'loop', 'l': 'loop',
      'الحين': 'np', 'now': 'np',
      'وقف مؤقت': 'pause', 'ps': 'pause',
      'كمل': 'resume', 'rs': 'resume',
      'صوت': 'volume', 'vol': 'volume',
      'طل': 'leave', 'اخرج': 'leave', 'dc': 'leave',
      'مساعدة': 'help', 'h': 'help'
    };

    if (aliases[cmdName]) cmdName = aliases[cmdName];

    const cmd = bot.commands.get(cmdName);
    if (!cmd) return;

    try {
      cmd.execute(message, args);
    } catch (err) {
      addLog(`❌ Command error: ${err.message}`);
      message.reply('❌ صار خطأ!');
    }
  });

  bot.on('ready', () => {
    addLog(`✅ ${bot.user.tag} شغال!`);
    addLog(`🎵 بوت موسيقى - SoundCloud & Spotify`);
  });
}

// ======== API ========

app.post('/api/start', async (req, res) => {
  const { token } = req.body;
  if (bot) return res.json({ success: false, error: 'البوت شغال!' });
  if (!token || token.length < 50) return res.json({ success: false, error: 'توكن غلط!' });
  botToken = token;
  try {
    bot = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
      ]
    });

    setupCommands();
    setupEvents();
    await bot.login(token);
    botStatus = 'online';
    res.json({ success: true });
  } catch (err) {
    bot = null;
    botStatus = 'offline';
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/stop', async (req, res) => {
  if (!bot) return res.json({ success: false, error: 'البوت مو شغال!' });
  try {
    // Clean up all voice connections
    queues.forEach((queue, guildId) => {
      if (queue.player) queue.player.stop();
      const conn = getVoiceConnection(guildId);
      if (conn) conn.destroy();
    });
    queues.clear();
    
    await bot.destroy();
    bot = null;
    botStatus = 'offline';
    addLog('🛑 البوت توقف');
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    status: botStatus,
    tag: bot?.user?.tag || null,
    guilds: bot?.guilds?.cache?.size || 0,
    queues: queues.size
  });
});

app.get('/api/logs', (req, res) => res.json(logs));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Music Bot Dashboard: http://localhost:${PORT}`));
