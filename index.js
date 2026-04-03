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
  DEV_ROLE_ID,
  CAZIER_CHANNEL_ID,
  MANDATE_CHANNEL_ID,
  INCIDENTE_CHANNEL_ID,
  POLICE_PANEL_CHANNEL_ID,
  DEFAULT_MANDATE_EXPIRE_MINUTES,
  DATABASE_URL,
} = process.env;

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

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) process.exit(1);
if (!DATABASE_URL) process.exit(1);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
});

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'police-db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ cazier: [], mandate: [], incidente: [] }, null, 2));
}

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { cazier: [], mandate: [], incidente: [] };
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function safeReply(interaction, data) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(data).catch(() => null);
  }
  return interaction.reply(data).catch(() => null);
}

function hasPoliceAccess(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (BOT_OWNER_ID && member.id === BOT_OWNER_ID) return true;
  if (DEV_ROLE_ID && member.roles.cache.has(DEV_ROLE_ID)) return true;
  return true;
}

function requirePolice(interaction) {
  if (!hasPoliceAccess(interaction.member)) {
    safeReply(interaction, {
      content: "⛔ Nu ai acces la Poliție.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

function requireGrade(interaction, min) {
  if (!requirePolice(interaction)) return false;
  return true;
}

function buildEmbed(title, desc) {
  return new EmbedBuilder()
    .setColor(0x0f4c81)
    .setTitle(title)
    .setDescription(desc)
    .setTimestamp();
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isModalSubmit()) {
      if (!requirePolice(interaction)) return;

      if (interaction.customId === 'cazier_add') {
        if (!requireGrade(interaction, 1)) return;

        const gameName = interaction.fields.getTextInputValue('game_name');

        const embed = buildEmbed("📁 Cazier adăugat", gameName);

        return safeReply(interaction, {
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (err) {
    console.error(err);

    return safeReply(interaction, {
      content: "❌ Eroare",
      flags: MessageFlags.Ephemeral,
    });
  }
});

client.login(DISCORD_TOKEN);
