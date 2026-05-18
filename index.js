const express = require("express");
const app = express();

app.get("/", (_, res) => res.send("Ticket bot running"));
app.listen(3000, () => console.log("Web server running"));

const {
  Client,
  GatewayIntentBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  EmbedBuilder
} = require("discord.js");

const { createClient } = require("@supabase/supabase-js");

// ================= SUPABASE =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ================= CONFIG =================
const PANEL_CHANNEL_ID = "1493646997138309150";

const BASIC_CATEGORY_ID = "1501169931549413386";
const MODMAIL_CATEGORY_ID = "1501169985228247170";
const CUSTOM_CATEGORY_ID = "1501170035794644992";
const SUPPORT_CATEGORY_ID = "1505938398291165225";

const STAFF_ROLE_ID = "1500152827337769111";

// ================= LOCK (prevents double click spam) =================
const creating = new Set();

// ================= READY =================
client.once("ready", async () => {
  console.log(`READY: ${client.user.tag}`);

  client.user.setPresence({
    activities: [{
      name: "handling tickets <3",
      type: 1,
      url: "https://twitch.tv/discord"
    }],
    status: "online"
  });

  console.log("Bot ready");
});

// ================= PANEL =================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content === "!panel") {
    if (message.channel.id !== PANEL_CHANNEL_ID) return;

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("ticket_select")
        .setPlaceholder("click & choose")
        .addOptions([
          {
            label: "basic bot",
            value: "basic",
            description: "⠀·⠀order basic bots"
          },
          {
            label: "modmail bot",
            value: "modmail",
            description: "⠀·⠀order modmail bots"
          },
          {
            label: "custom bot",
            value: "custom",
            description: "order custom bots"
          },
          {
            label: "changes / support",
            value: "support",
            description: "request changes or support"
          }
        ])
    );

    const embed = new EmbedBuilder()
      .setTitle("support tickets")
      .setDescription("⠀·⠀select a category below to open a ticket!")
      .setColor(0xffffff);

    await message.channel.send({
      embeds: [embed],
      components: [row]
    });
  }
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async (interaction) => {

  // ================= DROPDOWN =================
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId !== "ticket_select") return;

    const type = interaction.values[0];

    // IMPORTANT FIX → prevents "interaction failed"
    await interaction.deferReply({ ephemeral: true });

    // prevent double click spam
    if (creating.has(interaction.user.id)) {
      return interaction.editReply("please wait...");
    }

    creating.add(interaction.user.id);

    try {
      const categoryMap = {
        basic: BASIC_CATEGORY_ID,
        modmail: MODMAIL_CATEGORY_ID,
        custom: CUSTOM_CATEGORY_ID,
        support: SUPPORT_CATEGORY_ID
      };

      const categoryId = categoryMap[type];

      // SAFE CHECK (no crash)
      const { data: existing } = await supabase
        .from("tickets")
        .select("*")
        .eq("user_id", interaction.user.id)
        .eq("type", type)
        .eq("open", true)
        .maybeSingle();

      if (existing) {
        const ch = await client.channels.fetch(existing.channel_id).catch(() => null);
        creating.delete(interaction.user.id);

        return interaction.editReply(
          ch ? `you already have an open ticket: ${ch}` : "ticket already exists."
        );
      }

      const channelName = `${type}-${interaction.user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "");

      const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          },
          {
            id: STAFF_ROLE_ID,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          }
        ]
      });

      await supabase.from("tickets").insert({
        user_id: interaction.user.id,
        channel_id: channel.id,
        type,
        open: true
      });

      const closeBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("close")
          .setStyle(ButtonStyle.Secondary)
      );

      const embed = new EmbedBuilder()
        .setTitle(`${type} ticket`)
        .setDescription(`welcome ${interaction.user}\nplease explain your request.`)
        .setColor(0xffffff);

      await channel.send({
        content: `<@&${STAFF_ROLE_ID}>`,
        embeds: [embed],
        components: [closeBtn]
      });

      creating.delete(interaction.user.id);

      return interaction.editReply(`ticket created: ${channel}`);

    } catch (err) {
      creating.delete(interaction.user.id);
      console.error(err);
      return interaction.editReply("error creating ticket.");
    }
  }

// ================= CLOSE =================
if (interaction.isButton()) {
  if (interaction.customId !== "close_ticket") return;

  await interaction.deferReply({ ephemeral: true });

  try {
    // STEP 1: find ticket safely
    const { data: ticket, error } = await supabase
      .from("tickets")
      .select("*")
      .eq("channel_id", interaction.channel.id)
      .eq("open", true)
      .maybeSingle();

    // STEP 2: if DB fails, still allow close
    if (!ticket) {
      console.log("No DB ticket found, still closing channel");
    } else {
      await supabase
        .from("tickets")
        .update({ open: false })
        .eq("channel_id", interaction.channel.id);
    }

    await interaction.editReply("closing ticket...");

    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 2000);

  } catch (err) {
    console.error(err);

    // HARD fallback (never blocks closing)
    await interaction.editReply("closing ticket...");

    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 2000);
  }
}

client.login(process.env.TOKEN);
