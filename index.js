require('dotenv').config();
console.log('INDEX CAZIERE POSTGRES NOU');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  BOT_OWNER_ID,
  POLICE_ROLE_IDS,
  GRADE_SUBCOMISAR_ID,
  GRADE_COMISAR_ID,
  GRADE_COMISAR_SEF_ID,
  GRADE_SUB_CHESTOR_ID,
  GRADE_CHESTOR_GENERAL_ID,
  DEV_ROLE_ID,
  CAZIER_CHANNEL_ID,
  MANDATE_CHANNEL_ID,
  INCIDENTE_CHANNEL_ID,
  POLICE_PANEL_CHANNEL_ID,
  DEFAULT_MANDATE_EXPIRE_MINUTES,
  DATABASE_URL,
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ Lipsesc DISCORD_TOKEN / CLIENT_ID / GUILD_ID în .env');
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error('❌ Lipsește DATABASE_URL în .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway.internal')
    ? false
    : { rejectUnauthorized: false },
});

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'police-db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify({ cazier: [], mandate: [], incidente: [] }, null, 2),
    'utf8',
  );
}

function readDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

    if (!Array.isArray(db.cazier)) db.cazier = [];
    if (!Array.isArray(db.mandate)) db.mandate = [];
    if (!Array.isArray(db.incidente)) db.incidente = [];

    return db;
  } catch {
    return { cazier: [], mandate: [], incidente: [] };
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS caziere (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      added_by TEXT,
      added_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    ALTER TABLE caziere
    ADD COLUMN IF NOT EXISTS gamename TEXT;
  `);

  console.log('✅ Tabelul caziere este gata.');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS up_stats (
      officer_id TEXT PRIMARY KEY,
      officer_name TEXT,
      patrol_count INTEGER NOT NULL DEFAULT 0,
      total_ms BIGINT NOT NULL DEFAULT 0,
      last_activity_at BIGINT
    );
  `);

  console.log('✅ Tabelul up_stats este gata.');
}

async function addCazierToDb(gameName, reason, addedBy) {
  try {
    const result = await pool.query(
      `
      INSERT INTO caziere (user_id, reason, added_by, added_at, gamename)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, user_id, reason, added_by, added_at, gamename
      `,
      [gameName, reason, addedBy || null, Date.now(), gameName]
    );

    console.log('✅ Cazier salvat în Postgres:', result.rows[0]);
    return result.rows[0];
  } catch (err) {
    console.error('❌ Eroare la salvarea cazierului în Postgres:', err);
    throw err;
  }
}

async function addUpHours(officerId, officerName, hours, patrolsToAdd = 0) {
  const msToAdd = hours * 60 * 60 * 1000;

  const result = await pool.query(
    `
    INSERT INTO up_stats (officer_id, officer_name, patrol_count, total_ms, last_activity_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (officer_id)
    DO UPDATE SET
      officer_name = EXCLUDED.officer_name,
      patrol_count = up_stats.patrol_count + EXCLUDED.patrol_count,
      total_ms = up_stats.total_ms + EXCLUDED.total_ms,
      last_activity_at = EXCLUDED.last_activity_at
    RETURNING officer_id, officer_name, patrol_count, total_ms, last_activity_at
    `,
    [officerId, officerName, patrolsToAdd, msToAdd, Date.now()]
  );

  console.log('✅ UP stats actualizat:', result.rows[0]);
  return result.rows[0];
}

function parseRoleIds(raw) {
  return String(raw || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

const POLICE_ACCESS_ROLE_IDS = [
  ...parseRoleIds(POLICE_ROLE_IDS),
  DEV_ROLE_ID,
].filter(Boolean);

const GRADE_ORDER = {
  stagiar: 1,
  adjunct: 2,
  caporal: 3,
  sergent: 4,
  locotenent: 5,
  senior: 6,
  capitan: 7,
  capitan_sef: 8,
  comandant: 9,
  sef_divizie: 10,
  asistent_sheriff: 11,
  sub_sheriff: 12,
  sheriff_general: 13,
};

const GRADE_ROLE_MAP = {
  stagiar: process.env.ROLE_STAGIAR_ID,
  adjunct: process.env.ROLE_ADJUNCT_ID,
  caporal: process.env.ROLE_CAPORAL_ID,
  sergent: process.env.ROLE_SERGENT_ID,
  locotenent: process.env.ROLE_LOCOTENENT_ID,
  senior: process.env.ROLE_SENIOR_ID,
  capitan: process.env.ROLE_CAPITAN_ID,
  capitan_sef: process.env.ROLE_CAPITAN_SEF_ID,
  comandant: process.env.ROLE_COMANDANT_ID,
  sef_divizie: process.env.ROLE_SEF_DIVIZIE_ID,
  asistent_sheriff: process.env.ROLE_ASISTENT_SHERIFF_ID,
  sub_sheriff: process.env.ROLE_SUB_SHERIFF_ID,
  sheriff_general: process.env.ROLE_SHERIFF_GENERAL_ID,
};

const COLOR = {
  primary: 0x0f4c81,
  success: 0x1f8b4c,
  danger: 0xc0392b,
  warning: 0xf1c40f,
  neutral: 0x2f3136,
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function shortText(text, max = 1000) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function nowIso() {
  return new Date().toISOString();
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function ensureArray(obj, key) {
  if (!Array.isArray(obj[key])) obj[key] = [];
}

function hasDevAccess(member) {
  if (!member) return false;
  if (!DEV_ROLE_ID) return false;
  return member.roles.cache.has(DEV_ROLE_ID);
}

function getMemberGradeLevel(member) {
  if (!member) return 0;
  let max = 0;

  for (const [grade, roleId] of Object.entries(GRADE_ROLE_MAP)) {
    if (roleId && member.roles.cache.has(roleId)) {
      max = Math.max(max, GRADE_ORDER[grade] || 0);
    }
  }

  return max;
}

function hasPoliceAccess(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (BOT_OWNER_ID && member.id === BOT_OWNER_ID) return true;
  if (hasDevAccess(member)) return true;

  return Object.values(GRADE_ROLE_MAP).some(
    (roleId) => roleId && member.roles.cache.has(roleId)
  );
}

async function denyAccess(interaction, text = '⛔ Nu ai acces la acest sistem.') {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content: text, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  return interaction.reply({ content: text, flags: MessageFlags.Ephemeral }).catch(() => null);
}

function requirePolice(interaction) {
  if (!hasPoliceAccess(interaction.member)) {
    denyAccess(interaction, '⛔ Nu ai acces la comenzile Poliției.');
    return false;
  }
  return true;
}

function requireGrade(interaction, minLevel) {
  if (!requirePolice(interaction)) return false;
  if (hasDevAccess(interaction.member)) return true;

  const level = getMemberGradeLevel(interaction.member);
  if (level < minLevel) {
    denyAccess(interaction, `⛔ Nu ai grad suficient. Este necesar minim nivelul ${minLevel}.`);
    return false;
  }
  return true;
}

function buildPoliceEmbed(title, description, color = COLOR.primary) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'Inspectoratul General al Poliției' })
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `Sistem evidență poliție • ${new Date().toLocaleDateString('ro-RO')}` })
    .setTimestamp();
}

function buildCazierEntryText(entry, index) {
  return (
    `**${index}.** \`${entry.id}\`\n` +
    `**Nume joc:** ${shortText(entry.gameName || '-', 200)}\n` +
    `**Faptă:** ${shortText(entry.fapta, 300)}\n` +
    `**Sancțiune:** ${shortText(entry.sanctiune, 300)}\n` +
    `**Ofițer:** <@${entry.officerId}>\n` +
    `**Data:** <t:${Math.floor(new Date(entry.createdAt).getTime() / 1000)}:f>\n` +
    `**Detalii:** ${shortText(entry.detalii || 'Fără detalii', 500)}`
  );
}

function buildMandatText(m, index) {
  let base =
    `**${index}.** \`${m.id}\`\n` +
    `**Nume joc:** ${shortText(m.gameName || '-', 200)}\n` +
    `**ID joc:** ${m.gameId || '-'}\n` +
    `**Motiv:** ${shortText(m.motiv, 300)}\n` +
    `**Valabilitate:** ${shortText(m.durata, 200)}\n` +
    `**Emis de:** <@${m.emisDeId}>\n` +
    `**Emis la:** <t:${Math.floor(new Date(m.createdAt).getTime() / 1000)}:f>\n` +
    `**Status:** ${m.status}`;

  if (m.proofUrl) base += `\n**Dovadă:** ${shortText(m.proofUrl, 250)}`;
  if (m.expiresAt) base += `\n**Expiră la:** <t:${Math.floor(new Date(m.expiresAt).getTime() / 1000)}:f>`;
  if (m.closedAt) base += `\n**Finalizat la:** <t:${Math.floor(new Date(m.closedAt).getTime() / 1000)}:f>`;
  if (m.closeReason) base += `\n**Motiv finalizare:** ${shortText(m.closeReason, 300)}`;

  return base;
}

function buildHistoryEmbed(gameName, entries, mandates, incidents) {
  const latestEntries = entries.slice(-5).reverse();
  const latestMandates = mandates.slice(-5).reverse();
  const latestIncidents = incidents.slice(-5).reverse();

  const embed = buildPoliceEmbed(
    `🗂️ Istoric complet | ${gameName}`,
    `Fișă centralizată pentru **${gameName}**.`,
    COLOR.primary,
  ).addFields(
    { name: '📁 Înregistrări cazier', value: String(entries.length), inline: true },
    { name: '📜 Mandate totale', value: String(mandates.length), inline: true },
    { name: '🚨 Incidente asociate', value: String(incidents.length), inline: true },
  );

  embed.addFields({
    name: 'Ultimele înregistrări în cazier',
    value: latestEntries.length
      ? latestEntries.map((e, i) => buildCazierEntryText(e, i + 1)).join('\n\n').slice(0, 1024)
      : 'Nu există înregistrări.',
    inline: false,
  });

  embed.addFields({
    name: 'Ultimele mandate',
    value: latestMandates.length
      ? latestMandates.map((m, i) => buildMandatText(m, i + 1)).join('\n\n').slice(0, 1024)
      : 'Nu există mandate.',
    inline: false,
  });

  embed.addFields({
    name: 'Ultimele incidente',
    value: latestIncidents.length
      ? latestIncidents
          .map(
            (x, i) =>
              `**${i + 1}.** \`${x.id}\` - ${shortText(x.titlu, 120)}\n` +
              `Locație: ${shortText(x.locatie, 120)}\n` +
              `Data: <t:${Math.floor(new Date(x.createdAt).getTime() / 1000)}:f>`,
          )
          .join('\n\n')
          .slice(0, 1024)
      : 'Nu există incidente asociate.',
    inline: false,
  });

  return embed;
}

async function autoExpireMandates() {
  const db = readDb();
  let changed = false;
  const now = Date.now();

  for (const mandat of db.mandate || []) {
    if (mandat.status !== 'ACTIV') continue;
    if (!mandat.expiresAt) continue;
    if (now >= new Date(mandat.expiresAt).getTime()) {
      mandat.status = 'EXPIRAT';
      mandat.closedAt = nowIso();
      mandat.closeReason = 'Mandat expirat automat';
      changed = true;
    }
  }

  if (changed) writeDb(db);
}

const commands = [
  new SlashCommandBuilder()
    .setName('setup-politie')
    .setDescription('Creează categoria și canalele pentru Poliție')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('panel-politie')
    .setDescription('Trimite panelul profesional al Poliției')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('cazier-cauta')
    .setDescription('Caută un cazier după nume din joc')
    .addStringOption((o) => o.setName('nume').setDescription('Nume din joc').setRequired(true)),

  new SlashCommandBuilder()
    .setName('istoric-complet')
    .setDescription('Vezi istoricul complet după nume din joc')
    .addStringOption((o) => o.setName('nume').setDescription('Nume din joc').setRequired(true)),

  new SlashCommandBuilder()
    .setName('mandate-vezi')
    .setDescription('Vezi mandate după status')
    .addStringOption((o) =>
      o
        .setName('status')
        .setDescription('Tipul de mandate')
        .setRequired(true)
        .addChoices(
          { name: 'Active', value: 'ACTIV' },
          { name: 'Expirate', value: 'EXPIRAT' },
          { name: 'Închise', value: 'ÎNCHIS' },
        ),
    ),
].map((c) => c.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Slash commands înregistrate.');
}

async function sendLog(channelId, embed) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel.send({ embeds: [embed] }).catch(() => null);
}

async function createPoliceStructure(guild) {
  const everyone = guild.roles.everyone;

  const existingCategory = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === '🚔┃POLIȚIE',
  );

  const overwrites = [
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ...POLICE_ACCESS_ROLE_IDS.map((roleId) => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.SendMessagesInThreads,
      ],
    })),
  ];

  const category =
    existingCategory ||
    (await guild.channels.create({
      name: '🚔┃POLIȚIE',
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwrites,
    }));

  async function ensureChannel(name) {
    let ch = guild.channels.cache.find((c) => c.parentId === category.id && c.name === name);
    if (ch) return ch;
    ch = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites,
    });
    return ch;
  }

  const panel = await ensureChannel('📋┃panel-politie');
  const cazier = await ensureChannel('📁┃caziere');
  const mandate = await ensureChannel('📜┃mandate');
  const incidente = await ensureChannel('🚨┃incidente');

  return { category, panel, cazier, mandate, incidente };
}

function buildMainPanelEmbed() {
  return buildPoliceEmbed(
    '🚔 Sistem centralizat Poliție',
    'Panou operațional pentru gestionarea fișelor de cazier, mandatelor și incidentelor.\n\nSelectează o acțiune din butoanele de mai jos.',
    COLOR.primary,
  ).addFields(
    { name: '📁 Cazier', value: 'Adăugare, căutare și vizualizare completă.', inline: true },
    { name: '📜 Mandate', value: 'Emiterea și verificarea mandatelor active / expirate.', inline: true },
    { name: '🚨 Incidente', value: 'Raportare rapidă cu thread separat pentru fiecare caz.', inline: true },
  );
}

function buildMainPanelRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('police_panel:cazier_add').setLabel('Adaugă cazier').setEmoji('📁').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('police_panel:cazier_search').setLabel('Caută cazier').setEmoji('🔎').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('police_panel:history').setLabel('Istoric complet').setEmoji('🗂️').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('police_panel:mandat_add').setLabel('Emite mandat').setEmoji('📜').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('police_panel:mandate_list').setLabel('Mandate active / expirate').setEmoji('🧾').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('police_panel:incident_add').setLabel('Raportează incident').setEmoji('🚨').setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function sendPolicePanel(channel) {
  return channel.send({ embeds: [buildMainPanelEmbed()], components: buildMainPanelRows() });
}

async function handleCazierView(interaction, gameName) {
  const db = readDb();
  const normalized = normalizeText(gameName);
  const entries = (db.cazier || []).filter((x) => normalizeText(x.gameName) === normalized);

  if (!entries.length) {
    return interaction.reply({
      embeds: [buildPoliceEmbed('📁 Cazier inexistent', `Nu există înregistrări pentru **${gameName}**.`, COLOR.neutral)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const text = entries
    .slice(-10)
    .reverse()
    .map((e, i) => buildCazierEntryText(e, i + 1))
    .join('\n\n');

  return interaction.reply({
    embeds: [
      buildPoliceEmbed(`📁 Cazier | ${gameName}`, text.slice(0, 4000), COLOR.primary)
        .setFooter({ text: `Total înregistrări: ${entries.length}` }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHistoryView(interaction, gameName) {
  const db = readDb();
  const normalized = normalizeText(gameName);

  const entries = (db.cazier || []).filter((x) => normalizeText(x.gameName) === normalized);
  const mandates = (db.mandate || []).filter((x) => normalizeText(x.gameName) === normalized);
  const incidents = (db.incidente || []).filter((x) => normalizeText(x.suspectName) === normalized);

  return interaction.reply({
    embeds: [buildHistoryEmbed(gameName, entries, mandates, incidents)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSearchCazier(interaction, query) {
  const normalized = normalizeText(query);
  const db = readDb();

  const grouped = new Map();

  for (const entry of db.cazier || []) {
    const key = normalizeText(entry.gameName);
    if (!key) continue;
    if (!key.includes(normalized)) continue;

    if (!grouped.has(key)) {
      grouped.set(key, {
        gameName: entry.gameName,
        count: 0,
      });
    }

    grouped.get(key).count += 1;
  }

  const results = [...grouped.values()].sort((a, b) => b.count - a.count);

  if (!results.length) {
    return interaction.reply({
      embeds: [buildPoliceEmbed('🔎 Căutare cazier', `Nu am găsit niciun rezultat pentru: **${query}**`, COLOR.warning)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const desc = results
    .slice(0, 10)
    .map((x, i) => `**${i + 1}.** ${x.gameName} • ${x.count} înregistrări`)
    .join('\n');

  return interaction.reply({
    embeds: [buildPoliceEmbed('🔎 Rezultate căutare cazier', desc, COLOR.primary)],
    flags: MessageFlags.Ephemeral,
  });
}

async function createIncidentThread(message, incident, interaction) {
  if (!message?.channel?.isTextBased()) return null;

  const thread = await message.startThread({
    name: `incident-${incident.id}`.toLowerCase().slice(0, 90),
    autoArchiveDuration: 1440,
    reason: `Thread pentru incident ${incident.id}`,
  }).catch(() => null);

  if (!thread) return null;

  const embed = buildPoliceEmbed(
    `🧵 Dosar incident | ${incident.id}`,
    'Thread operațional creat automat pentru continuarea discuțiilor și actualizărilor pe caz.',
    COLOR.primary,
  ).addFields(
    { name: 'Titlu', value: shortText(incident.titlu, 200), inline: false },
    { name: 'Raportat de', value: `<@${interaction.user.id}>`, inline: true },
    { name: 'Locație', value: shortText(incident.locatie, 150), inline: true },
    { name: 'Suspect', value: incident.suspectName || 'Nespecificat', inline: true },
    { name: 'Descriere', value: shortText(incident.descriere, 1000), inline: false },
  );

  await thread.send({ embeds: [embed] }).catch(() => null);
  return thread;
}

client.once('clientReady', async () => {
  console.log(`✅ Bot online ca ${client.user.tag}`);
  await autoExpireMandates();
  setInterval(autoExpireMandates, 60 * 1000);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-politie') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: '⛔ Doar administratorii pot folosi această comandă.', flags: MessageFlags.Ephemeral });
        }

        const result = await createPoliceStructure(interaction.guild);
        return interaction.reply({
          content:
            `✅ Structura Poliției a fost creată/verificată.\n` +
            `• Panel: <#${result.panel.id}>\n` +
            `• Caziere: <#${result.cazier.id}>\n` +
            `• Mandate: <#${result.mandate.id}>\n` +
            `• Incidente: <#${result.incidente.id}>`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.commandName === 'panel-politie') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: '⛔ Doar administratorii pot folosi această comandă.', flags: MessageFlags.Ephemeral });
        }

        let channel = null;
        if (POLICE_PANEL_CHANNEL_ID) channel = await client.channels.fetch(POLICE_PANEL_CHANNEL_ID).catch(() => null);
        if (!channel) channel = interaction.channel;
        if (!channel?.isTextBased()) {
          return interaction.reply({ content: '⛔ Canal invalid pentru panel.', flags: MessageFlags.Ephemeral });
        }

        await sendPolicePanel(channel);
        return interaction.reply({ content: '✅ Panelul Poliției a fost trimis.', flags: MessageFlags.Ephemeral });
      }

      if (interaction.commandName === 'cazier-cauta') {
        if (!requireGrade(interaction, 1)) return;
        return handleSearchCazier(interaction, interaction.options.getString('nume', true));
      }

      if (interaction.commandName === 'istoric-complet') {
        if (!requireGrade(interaction, 1)) return;
        return handleHistoryView(interaction, interaction.options.getString('nume', true));
      }

      if (interaction.commandName === 'mandate-vezi') {
        if (!requireGrade(interaction, 1)) return;
        await autoExpireMandates();
        const status = interaction.options.getString('status', true);
        const db = readDb();
        const list = (db.mandate || []).filter((m) => m.status === status).slice(-10).reverse();

        if (!list.length) {
          return interaction.reply({
            embeds: [buildPoliceEmbed('📜 Mandate', `Nu există mandate cu statusul **${status}**.`, COLOR.neutral)],
            flags: MessageFlags.Ephemeral,
          });
        }

        return interaction.reply({
          embeds: [
            buildPoliceEmbed(
              `📜 Mandate ${status.toLowerCase()}`,
              list.map((m, i) => buildMandatText(m, i + 1)).join('\n\n').slice(0, 4000),
              COLOR.primary,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      return;
    }

    if (interaction.isButton()) {
      if (!interaction.customId.startsWith('police_panel:')) return;
      if (!requirePolice(interaction)) return;

      const action = interaction.customId.split(':')[1];

      if (action === 'cazier_add') {
        if (!requireGrade(interaction, 1)) return;

        const modal = new ModalBuilder()
          .setCustomId('police_modal:cazier_add')
          .setTitle('Adăugare cazier');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('game_name')
              .setLabel('Nume jucător (din joc)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('fapta')
              .setLabel('Faptă / infracțiune')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('sanctiune')
              .setLabel('Sancțiune')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('detalii')
              .setLabel('Detalii suplimentare')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false),
          ),
        );

        return interaction.showModal(modal);
      }

      if (action === 'cazier_search') {
        if (!requireGrade(interaction, 1)) return;

        const modal = new ModalBuilder()
          .setCustomId('police_modal:cazier_search')
          .setTitle('Căutare cazier');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('query')
              .setLabel('Nume jucător')
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
        );

        return interaction.showModal(modal);
      }

      if (action === 'history') {
        if (!requireGrade(interaction, 1)) return;

        const modal = new ModalBuilder()
          .setCustomId('police_modal:history')
          .setTitle('Istoric complet');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('game_name')
              .setLabel('Nume jucător (din joc)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
        );

        return interaction.showModal(modal);
      }

      if (action === 'mandat_add') {
        if (!requireGrade(interaction, 2)) return;

        const modal = new ModalBuilder()
          .setCustomId('police_modal:mandat_add')
          .setTitle('Emitere mandat');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('game_name')
              .setLabel('Nume jucător (din joc)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('game_id')
              .setLabel('ID din joc')
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('motiv')
              .setLabel('Motiv mandat')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('durata')
              .setLabel('Durata / valabilitate afișată')
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('proof_url')
              .setLabel('Link dovadă (Imgur / Discord / etc.)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false),
          ),
        );

        return interaction.showModal(modal);
      }

      if (action === 'mandate_list') {
        if (!requireGrade(interaction, 1)) return;

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('police_select:mandates_status')
            .setPlaceholder('Alege ce mandate vrei să vezi')
            .addOptions(
              { label: 'Mandate active', value: 'ACTIV', emoji: '🟢' },
              { label: 'Mandate expirate', value: 'EXPIRAT', emoji: '🟡' },
              { label: 'Mandate închise', value: 'ÎNCHIS', emoji: '🔴' },
            ),
        );

        return interaction.reply({
          embeds: [buildPoliceEmbed('📜 Filtrare mandate', 'Selectează statusul dorit din meniul de mai jos.', COLOR.primary)],
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (action === 'incident_add') {
        if (!requireGrade(interaction, 1)) return;

        const modal = new ModalBuilder()
          .setCustomId('police_modal:incident_add')
          .setTitle('Raportare incident');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('titlu')
              .setLabel('Titlu incident')
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('descriere')
              .setLabel('Descriere completă')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('suspect_name')
              .setLabel('Nume suspect (opțional)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('locatie')
              .setLabel('Locație')
              .setStyle(TextInputStyle.Short)
              .setRequired(false),
          ),
        );

        return interaction.showModal(modal);
      }

      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId !== 'police_select:mandates_status') return;
      if (!requireGrade(interaction, 1)) return;

      await autoExpireMandates();
      const status = interaction.values[0];
      const db = readDb();
      const list = (db.mandate || []).filter((m) => m.status === status).slice(-10).reverse();

      if (!list.length) {
        return interaction.update({
          embeds: [buildPoliceEmbed('📜 Mandate', `Nu există mandate cu statusul **${status}**.`, COLOR.neutral)],
          components: [],
        });
      }

      return interaction.update({
        embeds: [
          buildPoliceEmbed(
            `📜 Mandate ${status.toLowerCase()}`,
            list.map((m, i) => buildMandatText(m, i + 1)).join('\n\n').slice(0, 4000),
            COLOR.primary,
          ),
        ],
        components: [],
      });
    }

    if (interaction.isModalSubmit()) {
      if (!interaction.customId.startsWith('police_modal:')) return;
      if (!requirePolice(interaction)) return;

      const type = interaction.customId.split(':')[1];

      if (type === 'cazier_add') {
        if (!requireGrade(interaction, 1)) return;

        const gameName = interaction.fields.getTextInputValue('game_name').trim();
        const fapta = interaction.fields.getTextInputValue('fapta').trim();
        const sanctiune = interaction.fields.getTextInputValue('sanctiune').trim();
        const detalii = interaction.fields.getTextInputValue('detalii').trim() || 'Fără detalii suplimentare';

        const db = readDb();
        ensureArray(db, 'cazier');

        const entry = {
          id: makeId('CZ'),
          gameName,
          fapta,
          sanctiune,
          detalii,
          officerId: interaction.user.id,
          officerTag: interaction.user.tag,
          createdAt: nowIso(),
        };

        db.cazier.push(entry);
        writeDb(db);

        const savedPg = await addCazierToDb(
          gameName,
          `${fapta} | Sancțiune: ${sanctiune} | Detalii: ${detalii}`,
          interaction.user.id
        );

        console.log('✅ Inserare confirmată în Postgres pentru:', savedPg);

        const upRow = await addUpHours(interaction.user.id, interaction.user.tag, 5, 0);
        console.log(`✅ +5 ore UP adăugate în Postgres pentru ${interaction.user.tag}:`, upRow);

        const embed = buildPoliceEmbed(
          '📁 Înregistrare de cazier adăugată',
          `A fost creată o nouă fișă pentru **${gameName}**.`,
          COLOR.success,
        ).addFields(
          { name: 'ID cazier', value: `\`${entry.id}\``, inline: true },
          { name: 'Ofițer', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Data', value: `<t:${nowUnix()}:f>`, inline: true },
          { name: 'Nume joc', value: shortText(gameName, 200), inline: false },
          { name: 'Faptă', value: shortText(fapta, 1000), inline: false },
          { name: 'Sancțiune', value: shortText(sanctiune, 1000), inline: false },
          { name: 'Detalii', value: shortText(detalii, 1000), inline: false },
        );

        await sendLog(CAZIER_CHANNEL_ID, embed);
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      if (type === 'cazier_search') {
        if (!requireGrade(interaction, 1)) return;
        const query = interaction.fields.getTextInputValue('query').trim();
        return handleSearchCazier(interaction, query);
      }

      if (type === 'history') {
        if (!requireGrade(interaction, 1)) return;
        const gameName = interaction.fields.getTextInputValue('game_name').trim();
        return handleHistoryView(interaction, gameName);
      }

      if (type === 'mandat_add') {
        if (!requireGrade(interaction, 2)) return;

        const gameName = interaction.fields.getTextInputValue('game_name').trim();
        const gameId = interaction.fields.getTextInputValue('game_id').trim();
        const motiv = interaction.fields.getTextInputValue('motiv').trim();
        const durata = interaction.fields.getTextInputValue('durata').trim();
        const proofUrl = interaction.fields.getTextInputValue('proof_url').trim();
        const minutes = Number(DEFAULT_MANDATE_EXPIRE_MINUTES || 1440);

        if (!Number.isFinite(minutes) || minutes <= 0) {
          return denyAccess(interaction, '⛔ DEFAULT_MANDATE_EXPIRE_MINUTES din .env trebuie să fie valid.');
        }

        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + minutes * 60 * 1000);

        const db = readDb();
        ensureArray(db, 'mandate');

        const mandat = {
          id: makeId('MDT'),
          gameName,
          gameId,
          motiv,
          durata,
          proofUrl,
          emisDeId: interaction.user.id,
          emisDeTag: interaction.user.tag,
          status: 'ACTIV',
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          closedAt: null,
          closeReason: null,
          closedById: null,
        };

        db.mandate.push(mandat);
        writeDb(db);

        const embed = buildPoliceEmbed(
          '📜 Mandat emis',
          `Mandat nou pentru **${gameName}**.`,
          COLOR.success,
        ).addFields(
          { name: 'ID mandat', value: `\`${mandat.id}\``, inline: true },
          { name: 'Status', value: 'ACTIV', inline: true },
          { name: 'Emis de', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Nume joc', value: shortText(gameName, 200), inline: true },
          { name: 'ID din joc', value: gameId, inline: true },
          { name: 'Valabilitate', value: shortText(durata, 300), inline: true },
          { name: 'Expiră automat', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:f>`, inline: false },
          { name: 'Motiv', value: shortText(motiv, 1000), inline: false },
          { name: 'Dovadă', value: proofUrl || 'Nu a fost atașată', inline: false },
        );

        await sendLog(MANDATE_CHANNEL_ID, embed);
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      if (type === 'incident_add') {
        if (!requireGrade(interaction, 1)) return;

        const titlu = interaction.fields.getTextInputValue('titlu').trim();
        const descriere = interaction.fields.getTextInputValue('descriere').trim();
        const suspectName = interaction.fields.getTextInputValue('suspect_name').trim() || null;
        const locatie = interaction.fields.getTextInputValue('locatie').trim() || 'Nespecificată';

        const db = readDb();
        ensureArray(db, 'incidente');

        const incident = {
          id: makeId('INC'),
          titlu,
          descriere,
          suspectName,
          locatie,
          raportatDeId: interaction.user.id,
          raportatDeTag: interaction.user.tag,
          createdAt: nowIso(),
          threadId: null,
        };

        db.incidente.push(incident);
        writeDb(db);

        const embed = buildPoliceEmbed(
          '🚨 Incident nou',
          'A fost raportat un incident operațional.',
          COLOR.danger,
        ).addFields(
          { name: 'ID incident', value: `\`${incident.id}\``, inline: true },
          { name: 'Raportat de', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Locație', value: shortText(locatie, 200), inline: true },
          { name: 'Titlu', value: shortText(titlu, 200), inline: false },
          { name: 'Descriere', value: shortText(descriere, 1000), inline: false },
          { name: 'Suspect', value: suspectName || 'Nespecificat', inline: false },
        );

        const sent = await sendLog(INCIDENTE_CHANNEL_ID, embed);
        if (sent) {
          const thread = await createIncidentThread(sent, incident, interaction);
          if (thread) {
            const db2 = readDb();
            const target = (db2.incidente || []).find((x) => x.id === incident.id);
            if (target) {
              target.threadId = thread.id;
              writeDb(db2);
            }
          }
        }

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    }
  } catch (err) {
    console.error('❌ Eroare interactionCreate:', err);

    if (interaction.deferred || interaction.replied) {
      return interaction.followUp({
        content: '❌ A apărut o eroare la executarea acțiunii.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    }

    return interaction.reply({
      content: '❌ A apărut o eroare la executarea acțiunii.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => null);
  }
});

(async () => {
  try {
    await initDatabase();
    await registerCommands();
    await client.login(DISCORD_TOKEN);
  } catch (err) {
    console.error('❌ Pornire eșuată:', err);
    process.exit(1);
  }
})();