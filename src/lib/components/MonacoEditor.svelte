<script lang="ts">
  // Monaco Editor — le vrai moteur VS Code (prototype « Secure AI Multi-OS »,
  // phase 2 de docs/roadmap-secure-ai.md) intégré au panneau Fichiers.
  //
  // - Import DYNAMIQUE (await import) : Monaco n'est pas dans le bundle de
  //   démarrage (~2 Mo gzip) — le textarea reste le fallback instantané.
  // - Workers via `?worker` de Vite (editor + json/ts/css : 4 worker files).
  // - FS réel : le contenu vient des endpoints /api/sandbox (read/write),
  //   contrairement aux prototypes (FS en mémoire) — Monaco n'est que la
  //   vue d'édition.
  import { onMount } from 'svelte'
  import type * as MonacoNs from 'monaco-editor'
  // Entrées worker (fichiers minuscules, découpés en chunks séparés par Vite) :
  import MonacoEditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
  import MonacoJsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
  import MonacoCssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
  import MonacoTsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

  let {
    path,
    content,
    oninput,
    onerror,
  }: {
    path: string
    content: string
    oninput: (value: string) => void
    onerror?: () => void
  } = $props()

  let host: HTMLDivElement | undefined = $state()
  let error = $state(false)
  let monaco: typeof import('monaco-editor') | undefined
  let editor: MonacoNs.editor.IStandaloneCodeEditor | undefined
  let stampModel: MonacoNs.editor.ITextModel | undefined
  let applying = false

  const LANGS: [RegExp, string][] = [
    [/\.html?$/i, 'html'],
    [/\.css$/i, 'css'],
    [/\.json$/i, 'json'],
    [/\.(js|mjs|cjs)$/i, 'javascript'],
    [/\.ts$/i, 'typescript'],
    [/\.md$/i, 'markdown'],
    [/\.(py|sh|yml|yaml|xml|svg)$/i, 'plaintext'],
  ]
  const langOf = (p: string): string => LANGS.find(([re]) => re.test(p))?.[1] ?? 'plaintext'

  // Thème « ChatDeck » : suit le thème clair/sombre de l'app via les variables
  // calculées du panneau (fallback sombre si variables absentes).
  function defineTheme(m: typeof import('monaco-editor')): void {
    const cs = getComputedStyle(document.body)
    const v = (name: string, fb: string): string => cs.getPropertyValue(name).trim() || fb
    const dark = v('--bg', '#101418')
    const panel = v('--panel', dark)
    const fg = v('--text', '#e6edf3')
    const muted = v('--muted', '#8b949e')
    const border = v('--border', '#30363d')
    const accent = v('--accent', '#4f8cff')
    m.editor.defineTheme('chatdeck', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: muted.replace('#', ''), fontStyle: 'italic' },
        { token: 'string', foreground: '7ee787' },
        { token: 'keyword', foreground: accent.replace('#', '') },
        { token: 'number', foreground: 'd2a8ff' },
      ],
      colors: {
        'editor.background': panel,
        'editor.foreground': fg,
        'editorLineNumber.foreground': muted,
        'editorLineNumber.activeForeground': fg,
        'editor.selectionBackground': accent + '44',
        'editor.lineHighlightBackground': dark,
        'editorIndentGuide.background': border,
        'editorWidget.background': panel,
        'editorGutter.background': panel,
      },
    })
  }

  onMount(() => {
    void (async () => {
      try {
        // 1) Workers en premier (self.MonacoEnvironment lu à la création du webworker)
        self.MonacoEnvironment = {
          getWorker(_: unknown, label: string): Worker {
            if (label === 'json') return new MonacoJsonWorker()
            if (label === 'css' || label === 'scss' || label === 'less') return new MonacoCssWorker()
            if (label === 'typescript' || label === 'javascript') return new MonacoTsWorker()
            return new MonacoEditorWorker()
          },
        }
        monaco = await import('monaco-editor')
        if (!host) return
        defineTheme(monaco)
        editor = monaco.editor.create(host, {
          value: content,
          language: langOf(path),
          theme: 'chatdeck',
          automaticLayout: true,
          minimap: { enabled: true, scale: 1 },
          fontSize: 12.5,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          scrollBeyondLastLine: false,
          stickyScroll: { enabled: true },
          bracketPairColorization: { enabled: true },
          padding: { top: 8 },
        })
        editor.onDidChangeModelContent(() => {
          if (applying) return
          oninput(editor!.getValue())
        })
      } catch {
        error = true // fallback textarea côté FilesPanel
        onerror?.()
      }
    })()
    return () => {
      stampModel?.dispose()
      editor?.getModel()?.dispose()
      editor?.dispose()
      editor = undefined
    }
  })

  // Changement de fichier : nouveau model + langage, sans recréer l'éditeur.
  $effect(() => {
    if (!monaco || !editor || !host) return
    const uri = monaco.Uri.parse(`inmemory://sandbox/${path}`)
    let model = monaco.editor.getModel(uri)
    if (!model) model = monaco.editor.createModel(content, langOf(path), uri)
    applying = true
    editor.setModel(model)
    applying = false
    stampModel?.dispose()
    stampModel = model
  })

  // Contenu rechargé de l'extérieur (ex. PUT puis re-open) : on synchronise.
  $effect(() => {
    const model = editor?.getModel()
    if (!model || applying) return
    if (model.getValue() !== content) {
      applying = true
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null)
      applying = false
  }
  })
</script>

<div class="monaco-host" class:failed={error}></div>

<style>
  .monaco-host {
    height: 240px;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .monaco-host.failed {
    display: none; /* FilesPanel retombe sur le textarea */
  }
</style>
