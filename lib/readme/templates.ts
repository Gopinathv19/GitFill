/**
 * README templates: a style (header, badges, emoji headings, callouts, generated images) plus an
 * ordered table of contents drawn from a catalogue of sections. Users pick a template, then add,
 * remove and reorder sections or add their own; or they paste a README they like and GitFill
 * follows its structure and style with this repository's facts.
 *
 * Pure data: safe to import in client components (the README wizard).
 */

export const README_TEMPLATE_IDS = ["showcase", "open_source", "service", "research", "minimal"] as const;
export type ReadmeTemplateId = (typeof README_TEMPLATE_IDS)[number];

export interface ReadmeSection {
  id: string;
  title: string;
  emoji: string;
  /** What the writer puts in the section; it is the section's brief, not text to copy. */
  guide: string;
}

/** Every section a template or the user can include, in a sensible default order. */
export const SECTIONS: ReadmeSection[] = [
  { id: "one_chat", title: "In one example", emoji: "💬", guide: "One short, concrete example of the product in use (a request and the response, a command and its output), taken from the code, tests or the team's notes. Then two sentences on what it shows." },
  { id: "problem", title: "The problem", emoji: "❓", guide: "Who has the problem and why current options fall short; a table (option · what happens · why it hurts) when there are several. Use the team's notes; never invent market facts." },
  { id: "solution", title: "Our solution", emoji: "✅", guide: "What the project does about it, as 3-5 numbered steps from the user's point of view, ending with the one benefit that matters most." },
  { id: "why_different", title: "Why it's different", emoji: "⭐", guide: "A comparison table (aspect · typical approach · this project) with rows the code supports." },
  { id: "overview", title: "Overview", emoji: "📖", guide: "What the project is, who it is for and what it does, in two short paragraphs." },
  { id: "features", title: "Features", emoji: "🧩", guide: "Features grouped by who uses them (bold group headings), each a bullet with the feature in bold and one sentence on what it does. Only implemented features." },
  { id: "how_it_works", title: "How it works", emoji: "🧠", guide: "The main flow: the generated flow image when available, then 3-5 bullets with the key guarantees or steps in bold." },
  { id: "architecture", title: "Architecture", emoji: "🏗️", guide: "The generated architecture image when available, then a table (part · job) naming the real components." },
  { id: "tech_stack", title: "Tech stack", emoji: "🛠️", guide: "A table (layer · technology · why) for languages, frameworks, storage and services found in the code." },
  { id: "quick_start", title: "Quick start", emoji: "⚡", guide: "The shortest path to a working result: install and one usage example, as code blocks with real commands." },
  { id: "usage", title: "Usage", emoji: "🚀", guide: "Numbered steps for the main tasks a user does, naming real screens, commands or API calls." },
  { id: "install", title: "Installation", emoji: "📦", guide: "How to install or embed it, with code blocks per platform when the project supports several." },
  { id: "api", title: "API", emoji: "🔌", guide: "A table of the public endpoints, commands or functions (name · purpose), from the detected routes or exports." },
  { id: "data_model", title: "Data model", emoji: "🗃️", guide: "The main entities and what they hold, as a table." },
  { id: "run_locally", title: "Run it locally", emoji: "💻", guide: "Prerequisites, then numbered steps with code blocks for each part, using only commands found in the repository (scripts, Makefile, Dockerfile, docs)." },
  { id: "configuration", title: "Configuration", emoji: "⚙️", guide: "A table of environment variables or settings (variable · value or purpose) found in the code or .env.example, then a one-line note on keeping secrets out of git." },
  { id: "deployment", title: "Deployment", emoji: "☁️", guide: "How it is built and deployed (Dockerfile, CI, cloud config) when the repository shows it." },
  { id: "built_with", title: "Built with", emoji: "🔧", guide: "The key model, service or library the project is built on, with a table of how it is configured (setting · value · why) when the code shows it." },
  { id: "results", title: "Results", emoji: "📊", guide: "Measured results, benchmarks or evaluations with numbers that appear in the repository or the team's notes; never invent numbers." },
  { id: "testing", title: "Testing", emoji: "🧪", guide: "How to run the tests and what they cover, with the real commands." },
  { id: "roadmap", title: "Roadmap", emoji: "🗺️", guide: "Planned work, from TODOs, issues or the team's notes, as a short checklist." },
  { id: "faq", title: "FAQ", emoji: "💡", guide: "3-6 questions a newcomer would ask, answered from the code." },
  { id: "repository", title: "Repository", emoji: "📁", guide: "A table of the top-level folders (folder · what it is · port when it is a service), with links to the folders." },
  { id: "contributing", title: "Contributing", emoji: "🤝", guide: "How to contribute: setup for development, tests to run, code style, where to open issues (only what the repository supports)." },
  { id: "citation", title: "Citation", emoji: "📝", guide: "A BibTeX block when the repository or the team's notes give one." },
  { id: "license", title: "License", emoji: "📄", guide: "The license from the LICENSE file, in one or two sentences." },
];

export const SECTION_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

export interface ReadmeStyle {
  /** A generated banner image at the top. */
  banner: boolean;
  /** shields.io badges for the stack found in the code. */
  badges: boolean;
  /** Emoji before each section heading. */
  emoji: boolean;
  /** A numbered contents list after the header. */
  contents: boolean;
  /** Centered header block (banner, badges, links). */
  centered: boolean;
  /** Horizontal rules between sections. */
  rules: boolean;
  /** A GitHub alert callout (> [!TIP]) under the header for the one thing to know. */
  callout: boolean;
  /** Generated architecture and flow diagrams. */
  diagrams: boolean;
}

export interface ReadmeTemplate {
  id: ReadmeTemplateId;
  name: string;
  description: string;
  bestFor: string;
  sections: string[];
  style: ReadmeStyle;
  /** Deck template whose colours the generated images use by default. */
  imageTheme: string;
  /** How the prose should sound. */
  voice: string;
}

export const README_TEMPLATES: Record<ReadmeTemplateId, ReadmeTemplate> = {
  showcase: {
    id: "showcase",
    name: "Product showcase",
    description: "Banner, badges, emoji sections, problem and solution, colourful architecture and flow images.",
    bestFor: "Hackathons, products, demos",
    sections: ["one_chat", "problem", "solution", "why_different", "features", "how_it_works", "architecture", "usage", "install", "run_locally", "configuration", "built_with", "testing", "repository", "license"],
    style: { banner: true, badges: true, emoji: true, contents: true, centered: true, rules: true, callout: true, diagrams: true },
    imageTheme: "aurora",
    voice: "Confident and plain, written for someone deciding whether to use or judge the project: lead with the benefit, then the proof.",
  },
  open_source: {
    id: "open_source",
    name: "Open-source library",
    description: "Badges, a one-line pitch, install and quick start first, then usage, API and contributing.",
    bestFor: "Packages, CLIs, SDKs",
    sections: ["overview", "features", "install", "quick_start", "usage", "api", "configuration", "architecture", "testing", "contributing", "license"],
    style: { banner: false, badges: true, emoji: false, contents: true, centered: false, rules: false, callout: false, diagrams: true },
    imageTheme: "daylight",
    voice: "Direct and developer-to-developer: show code early, keep prose short.",
  },
  service: {
    id: "service",
    name: "Service / backend",
    description: "Architecture first: components, API, data model, configuration, deployment and operations.",
    bestFor: "Internal services, APIs, platforms",
    sections: ["overview", "architecture", "how_it_works", "api", "data_model", "tech_stack", "run_locally", "configuration", "deployment", "testing", "repository"],
    style: { banner: false, badges: false, emoji: false, contents: true, centered: false, rules: true, callout: true, diagrams: true },
    imageTheme: "midnight",
    voice: "Precise and operational, for the engineers who will run and change it.",
  },
  research: {
    id: "research",
    name: "Research / ML",
    description: "The idea, the method as a pipeline image, results, how to reproduce, and citation.",
    bestFor: "ML models, experiments, papers",
    sections: ["overview", "how_it_works", "results", "quick_start", "run_locally", "configuration", "repository", "citation", "license"],
    style: { banner: true, badges: true, emoji: false, contents: true, centered: true, rules: true, callout: false, diagrams: true },
    imageTheme: "paper",
    voice: "Careful and exact: claims match the evidence, numbers come with how they were measured.",
  },
  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "Title, what it does, install, usage, license. Nothing else.",
    bestFor: "Small tools, scripts, prototypes",
    sections: ["overview", "install", "usage", "license"],
    style: { banner: false, badges: false, emoji: false, contents: false, centered: false, rules: false, callout: false, diagrams: false },
    imageTheme: "daylight",
    voice: "Brief: every sentence earns its place.",
  },
};

export function isReadmeTemplateId(id: string): id is ReadmeTemplateId {
  return (README_TEMPLATE_IDS as readonly string[]).includes(id);
}

/** A section as the user arranged it: a catalogue id (or "custom") with an optional title and note. */
export interface ChosenSection {
  id: string;
  title?: string;
  note?: string;
}

/** The writer's brief for each section, in the user's order. Custom sections carry the user's note. */
export function sectionBriefs(sections: ChosenSection[], style: Pick<ReadmeStyle, "emoji">): string {
  return sections
    .map((s, i) => {
      const known = SECTION_BY_ID.get(s.id);
      const title = s.title?.trim() || known?.title || "Section";
      const heading = style.emoji && known ? `${known.emoji} ${title}` : title;
      const guide = [known?.guide, s.note?.trim() ? `The team asks: ${s.note.trim()}` : ""].filter(Boolean).join(" ");
      return `${i + 1}. "## ${heading}" — ${guide || "Write what the title promises, from the evidence."}`;
    })
    .join("\n");
}
