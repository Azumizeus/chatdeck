#!/usr/bin/env node
// anki-export.mjs — génère un export Anki TSV depuis un coffret StudyVault.
//
// Sources acceptées (dans l'ordre) :
//   1. <coffret>/anki.md    — format dédié (voir ci-dessous)
//   2. <coffret>/quiz.md    — questions numérotées + section « Réponses »
//
// Format anki.md (recommandé pour les nouveaux coffrets) :
//   ## Q: question …
//   R: réponse …
//   T: tag1 tag2            (optionnel)
//   (bloc séparé par une ligne vide ; le « ## » est ignoré)
//
// Sortie : TSV avec en-têtes natifs Anki 23.10+ (#separator:tab, #html:false,
// #tags column:3). Si anki-nexus.txt / anki-<nom>.txt existe déjà, il est
// écrasé (regénération = toujours depuis la source markdown).
//
// Usage :
//   node tools/anki-export.mjs <coffret>            # ex. ~/.chatdeck/workspaces/p-xxx/StudyVault/nexus
//   node tools/anki-export.mjs <coffret> -o out.txt # autre fichier de sortie
//   node tools/anki-export.mjs --all <racine>       # tous les coffrets d'une racine StudyVault/

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

function parseAnkiMd(text) {
  const cards = [];
  const blocks = text.split(/\n\s*\n/);
  for (const block of blocks) {
    // un bloc carte commence (après un éventuel titre markdown) par « Q: »
    if (!/^\s*(#{1,6}\s*)?Q:/.test(block)) continue;
    const q = block.match(/Q:\s*([\s\S]*?)(?=\nR:|$)/);
    const a = block.match(/R:\s*([\s\S]*?)(?=\nT:|$)/);
    if (!q || !a) continue;
    const t = block.match(/T:\s*(.+)/);
    cards.push({
      question: clean(q[1]),
      answer: clean(a[1]),
      tags: t ? t[1].trim().replace(/\s+/g, ' ') : 'studyvault',
    });
  }
  return cards;
}

function parseQuizMd(text) {
  // Format 1 : « ### Q1 (réponse: X) » + question en dessous (réponse inline)
  const inline = [];
  for (const m of text.matchAll(/^\s*#{2,4}\s*Q\d+\s*\(réponse:\s*([^)]+)\)\s*\n(.+)$/gim)) {
    inline.push({ question: clean(m[2]), answer: clean(m[1]) });
  }
  if (inline.length > 0) {
    return inline.map(c => ({ ...c, tags: 'studyvault quiz' }));
  }
  // Format 2 : questions numérotées + section « Réponses »
  const cards = [];
  // Questions : lignes « 1. … » (ou « 1) … ») avant la section Réponses
  const qSection = text.split(/^#{2,3}\s*R[ée]ponses\s*$/im)[0];
  const questions = [];
  for (const m of qSection.matchAll(/^\s*\d+[.)]\s+(.+)$/gm)) questions.push(clean(m[1]));
  // Réponses : lignes « 1. … » après la section Réponses
  const aMatch = text.match(/^#{2,3}\s*R[ée]ponses\s*$/im);
  const answers = [];
  if (aMatch) {
    for (const m of aMatch.input.slice(aMatch.index).matchAll(/^\s*\d+[.)]\s+(.+)$/gm)) answers.push(clean(m[1]));
  }
  for (let i = 0; i < questions.length; i++) {
    if (!answers[i]) fail(`quiz sans réponse pour la question ${i + 1} (section « Réponses » requise)`);
    cards.push({ question: questions[i], answer: answers[i], tags: 'studyvault quiz' });
  }
  return cards;
}

function clean(s) {
  return s
    .replace(/\*\*/g, '')            // gras markdown → texte (Anki affiche le HTML désactivé)
    .replace(/\s+/g, ' ')
    .replace(/\t/g, ' ')             // jamais de tab dans un champ TSV
    .trim();
}

function exportCoffret(dir, outPath) {
  const ankiMd = join(dir, 'anki.md');
  const quizMd = join(dir, 'quiz.md');
  let cards;
  if (existsSync(ankiMd)) {
    cards = parseAnkiMd(readFileSync(ankiMd, 'utf8'));
    console.log(`  source: anki.md`);
  } else if (existsSync(quizMd)) {
    cards = parseQuizMd(readFileSync(quizMd, 'utf8'));
    console.log(`  source: quiz.md`);
  } else {
    console.log(`  ⊘ pas d'anki.md ni de quiz.md — ignoré`);
    return false;
  }
  if (cards.length === 0) fail(`0 carte extraite de ${dir}`);
  const name = basename(dir).replace(/[^\w-]/g, '');
  const tsv =
    ['#separator:tab', '#html:false', '#tags column:3',
      ...cards.map(c => `${c.question}\t${c.answer}\t${c.tags}`),
      ''].join('\n');
  writeFileSync(outPath, tsv);
  console.log(`  ✓ ${cards.length} cartes → ${outPath}`);
  return true;
}

const argv = process.argv.slice(2);
const allIdx = argv.indexOf('--all');
if (allIdx !== -1) {
  const root = resolve(argv[allIdx + 1] ?? fail('--all <racine> requis'));
  if (!statSync(root).isDirectory()) fail(`${root} n'est pas un dossier`);
  let n = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    console.log(`${entry.name}/`);
    if (exportCoffret(join(root, entry.name), join(root, entry.name, `anki-${entry.name.replace(/[^\w-]/g, '')}.txt`))) n++;
  }
  console.log(`\n${n} coffret(s) exporté(s) depuis ${root}`);
} else {
  const dir = resolve(argv[0] ?? fail('usage: node tools/anki-export.mjs <coffret> | --all <racine>'));
  if (!statSync(dir).isDirectory()) fail(`${dir} n'est pas un dossier`);
  const outIdx = argv.indexOf('-o');
  const name = basename(dir).replace(/[^\w-]/g, '');
  const out = outIdx !== -1 ? resolve(argv[outIdx + 1]) : join(dir, `anki-${name}.txt`);
  exportCoffret(dir, out) || process.exit(1);
}
