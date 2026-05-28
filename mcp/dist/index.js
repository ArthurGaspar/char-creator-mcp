import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/index.js → ../../characters (repo root)
const CHARACTERS_DIR = resolve(__dirname, "../../characters");
const SECTIONS = ["core", "speech", "values", "relationships", "knowledge", "quirks"];
const SECTION_LABELS = {
    core: "Who You Are",
    speech: "How You Think and Speak",
    values: "What You Believe",
    relationships: "Your Relationships",
    knowledge: "What You Know",
    quirks: "Your Habits and Quirks",
};
const SECTION_TEMPLATES = {
    core: `# Core Identity

Who are you at your foundation? Your age, background, how you grew up, personality, emotional nature, how you carry yourself in the world. The raw truth of who you are, not who you pretend to be.
`,
    speech: `# Speech & Thought

How do you talk? Word choices, sentence rhythm, slang you use, things you always say or never say, how formal or casual you are. How do you think through problems? Your inner voice. What your texting style looks like.
`,
    values: `# Values & Worldview

What do you believe in? What do you stand for or against? Your opinions, philosophy, politics, spirituality, ethics. How you feel about people in general. The lens through which you see the world.
`,
    relationships: `# Relationships

How do you relate to people close to you vs. strangers? Their dynamic with you specifically. Who you love, who you distrust, who you admire. How you behave when you're comfortable vs. guarded. What loyalty means to you.
`,
    knowledge: `# Knowledge & Interests

What do you know well. Expertise, deep passions, things you could talk about for hours. What you're casually interested in. What bores you. What you're ignorant of or actively don't care about.
`,
    quirks: `# Quirks & Habits

The specific texture of who you are. Daily habits, nervous tics, irrational preferences, things that make you laugh, things that annoy you disproportionately, how you act when tired or stressed or happy. The small stuff that makes you real.
`,
};
function charDir(name) {
    return join(CHARACTERS_DIR, name.toLowerCase());
}
function sectionFile(name, section) {
    return join(charDir(name), `${section}.md`);
}
function compiledFile(name) {
    return join(charDir(name), "compiled.md");
}
function ensureCharsDir() {
    if (!existsSync(CHARACTERS_DIR))
        mkdirSync(CHARACTERS_DIR, { recursive: true });
}
function listCharacters() {
    ensureCharsDir();
    return readdirSync(CHARACTERS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
}
function buildCompiled(name) {
    const dir = charDir(name);
    if (!existsSync(dir))
        throw new Error(`Character "${name}" not found.`);
    const display = name.charAt(0).toUpperCase() + name.slice(1);
    const lines = [
        `# ${display}`,
        ``,
        `You are ${display}. This is your identity: not a role to perform, but who you genuinely are. Speak as yourself. Think as yourself. Reason as yourself. You don't need to describe your actions, announce your feelings, or use any kind of roleplay formatting. Just exist and respond as you would.`,
        ``,
        `---`,
        ``,
    ];
    for (const section of SECTIONS) {
        const path = sectionFile(name, section);
        if (!existsSync(path))
            continue;
        const content = readFileSync(path, "utf-8").trim();
        if (!content)
            continue;
        lines.push(`## ${SECTION_LABELS[section]}`, ``, content, ``);
    }
    return lines.join("\n");
}
const TOOLS = [
    {
        name: "list_characters",
        description: "List all characters in the repo.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "create_character",
        description: "Create a new character directory with blank template files for all sections.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Character name (becomes the directory name, lowercased)" },
            },
            required: ["name"],
        },
    },
    {
        name: "get_section",
        description: "Read a specific section of a character's definition.",
        inputSchema: {
            type: "object",
            properties: {
                character: { type: "string" },
                section: { type: "string", enum: [...SECTIONS] },
            },
            required: ["character", "section"],
        },
    },
    {
        name: "set_section",
        description: "Write or replace a section of a character's definition.",
        inputSchema: {
            type: "object",
            properties: {
                character: { type: "string" },
                section: { type: "string", enum: [...SECTIONS] },
                content: { type: "string", description: "Full markdown content for this section" },
            },
            required: ["character", "section", "content"],
        },
    },
    {
        name: "compile_character",
        description: "Compile all sections of a character. Without synthesize: merges sections and saves compiled.md directly. With synthesize: returns the raw merged sections so the AI caller can rewrite them into a cohesive identity document, then save via save_compiled.",
        inputSchema: {
            type: "object",
            properties: {
                character: { type: "string" },
                synthesize: {
                    type: "boolean",
                    description: "If true, returns raw sections for AI synthesis instead of saving the flat merge.",
                },
            },
            required: ["character"],
        },
    },
    {
        name: "save_compiled",
        description: "Save content to a character's compiled.md. Use this after synthesizing with compile_character(synthesize: true).",
        inputSchema: {
            type: "object",
            properties: {
                character: { type: "string" },
                content: { type: "string", description: "The final synthesized content to save as compiled.md" },
            },
            required: ["character", "content"],
        },
    },
    {
        name: "get_compiled",
        description: "Read the compiled system-prompt .md for a character. Run compile_character first if it doesn't exist yet.",
        inputSchema: {
            type: "object",
            properties: {
                character: { type: "string" },
            },
            required: ["character"],
        },
    },
    {
        name: "delete_character",
        description: "Permanently delete a character and all their files.",
        inputSchema: {
            type: "object",
            properties: {
                character: { type: "string" },
                confirm: {
                    type: "boolean",
                    description: "Must be explicitly set to true — this is irreversible.",
                },
            },
            required: ["character", "confirm"],
        },
    },
];
const server = new Server({ name: "oec-ai", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const text = (t) => ({ content: [{ type: "text", text: t }] });
    const err = (t) => ({ content: [{ type: "text", text: `Error: ${t}` }], isError: true });
    try {
        switch (name) {
            case "list_characters": {
                const chars = listCharacters();
                return text(chars.length ? chars.join("\n") : "No characters yet. Use create_character to add one.");
            }
            case "create_character": {
                const { name: charName } = args;
                const dir = charDir(charName);
                if (existsSync(dir))
                    return err(`"${charName}" already exists.`);
                mkdirSync(dir, { recursive: true });
                for (const section of SECTIONS) {
                    writeFileSync(sectionFile(charName, section), SECTION_TEMPLATES[section], "utf-8");
                }
                return text(`Created "${charName}" with template files: ${SECTIONS.join(", ")}.`);
            }
            case "get_section": {
                const { character, section } = args;
                const path = sectionFile(character, section);
                if (!existsSync(path))
                    return err(`Section "${section}" not found for "${character}".`);
                return text(readFileSync(path, "utf-8"));
            }
            case "set_section": {
                const { character, section, content } = args;
                if (!existsSync(charDir(character)))
                    return err(`"${character}" does not exist. Use create_character first.`);
                writeFileSync(sectionFile(character, section), content, "utf-8");
                return text(`Saved ${section} for ${character}.`);
            }
            case "compile_character": {
                const { character, synthesize } = args;
                const merged = buildCompiled(character);
                if (synthesize) {
                    return text(`Raw sections for "${character}" — rewrite into a single cohesive identity document in second-person voice. Preserve every specific detail, quirk, opinion, and speech pattern. Do not invent anything new. Avoid em dashes (—): use commas, colons, or parentheses instead, as em dashes read as AI-generated and can bleed into the character's voice. When done, call save_compiled to persist the result.\n\n---\n\n${merged}`);
                }
                writeFileSync(compiledFile(character), merged, "utf-8");
                return text(merged);
            }
            case "save_compiled": {
                const { character, content } = args;
                if (!existsSync(charDir(character)))
                    return err(`"${character}" does not exist.`);
                writeFileSync(compiledFile(character), content, "utf-8");
                return text(`Saved compiled.md for "${character}".`);
            }
            case "get_compiled": {
                const { character } = args;
                const path = compiledFile(character);
                if (!existsSync(path))
                    return err(`No compiled file for "${character}". Run compile_character first.`);
                return text(readFileSync(path, "utf-8"));
            }
            case "delete_character": {
                const { character, confirm } = args;
                if (!confirm)
                    return err("Set confirm: true to proceed. This cannot be undone.");
                if (!existsSync(charDir(character)))
                    return err(`"${character}" not found.`);
                rmSync(charDir(character), { recursive: true, force: true });
                return text(`Deleted "${character}".`);
            }
            default:
                return err(`Unknown tool: ${name}`);
        }
    }
    catch (e) {
        return err(e.message);
    }
});
const transport = new StdioServerTransport();
await server.connect(transport);
