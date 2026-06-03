import { useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useAvatarStore, DEFAULT_VRM_URL } from '@/store/avatarStore'
import { cn } from '@/lib/utils'
import { Sparkles, Upload, User, Check, RotateCcw } from 'lucide-react'

/**
 * Virtual Assistant identity form (Hub → Settings).
 * Rules:
 *  - Name & Persona are REQUIRED.
 *  - Default character is the built-in `character.vrm` with a locked FEMALE voice.
 *  - The voice gender switch only unlocks once a custom VRM is uploaded.
 *  - Saving persists the config; the per-project live-assistant agent is
 *    (re)generated from the persona when a project opens.
 */
export function VirtualAssistantSettings() {
  const store = useAvatarStore()

  // Draft state — committed only on Save.
  const [name, setName] = useState(store.assistantName)
  const [persona, setPersona] = useState(store.persona)
  const [gender, setGender] = useState<'woman' | 'man'>(store.voiceGender)
  const [vrmUrl, setVrmUrl] = useState(store.vrmUrl)
  const [vrmLabel, setVrmLabel] = useState(store.vrmUrl === DEFAULT_VRM_URL ? 'Bawaan (Claudia)' : 'VRM custom')
  const [saved, setSaved] = useState(false)

  const isCustomVrm = vrmUrl !== DEFAULT_VRM_URL
  const nameOk = name.trim().length > 0
  const personaOk = persona.trim().length > 0
  const canSave = nameOk && personaOk

  const pickVrm = async () => {
    try {
      const sel = await openDialog({ multiple: false, directory: false, filters: [{ name: 'VRM', extensions: ['vrm'] }] })
      if (typeof sel === 'string') {
        setVrmUrl(convertFileSrc(sel))
        setVrmLabel(sel.split('/').pop() ?? 'VRM custom')
      }
    } catch { /* cancelled */ }
  }

  const resetVrm = () => {
    setVrmUrl(DEFAULT_VRM_URL)
    setVrmLabel('Bawaan (Claudia)')
    setGender('woman') // default character is female
  }

  const save = () => {
    if (!canSave) return
    store.setAssistantName(name.trim())
    store.setPersona(persona.trim())
    // Default VRM forces female voice; custom VRM honors the chosen gender.
    store.setVoiceGender(isCustomVrm ? gender : 'woman')
    store.setVrmUrl(vrmUrl)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="mb-4 p-3 rounded-xl bg-surface2/50 border border-white/5 space-y-3">
      <p className="text-xs font-mono font-semibold text-muted flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-accent" /> Virtual Assistant
      </p>

      {/* Name (required) */}
      <div>
        <label className="text-[11px] text-text">Nama <span className="text-error">*</span></label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="mis. Claudia"
          className={cn('w-full mt-1 bg-surface2 rounded-lg px-3 py-2 text-xs font-mono text-text placeholder-muted/50 outline-none border focus:ring-1',
            nameOk ? 'border-white/5 focus:ring-accent/50' : 'border-error/40 focus:ring-error/50')} />
      </div>

      {/* Persona (required) */}
      <div>
        <label className="text-[11px] text-text">Persona <span className="text-error">*</span></label>
        <textarea value={persona} onChange={e => setPersona(e.target.value)} rows={3}
          placeholder="Karakter & gaya bicara asisten — mis. ramah, ringkas, suka memberi semangat."
          className={cn('w-full mt-1 bg-surface2 rounded-lg px-3 py-2 text-xs font-mono text-text placeholder-muted/50 outline-none border focus:ring-1 resize-none',
            personaOk ? 'border-white/5 focus:ring-accent/50' : 'border-error/40 focus:ring-error/50')} />
        <p className="text-[10px] text-muted/50 mt-0.5">Dipakai sebagai instruksi tambahan untuk live-assistant agent.</p>
      </div>

      {/* VRM model */}
      <div>
        <p className="text-[11px] text-text mb-1">Karakter (VRM)</p>
        <div className="flex items-center gap-1.5">
          <button onClick={pickVrm}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono bg-surface2 border border-white/10 text-text hover:text-accent hover:border-accent/30 cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" /> Upload VRM
          </button>
          {isCustomVrm && (
            <button onClick={resetVrm} title="Kembali ke karakter bawaan"
              className="p-1.5 rounded-lg text-muted hover:text-text border border-white/10 cursor-pointer transition-colors">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="text-[10px] text-muted/70 font-mono truncate">{vrmLabel}</span>
        </div>
      </div>

      {/* Voice gender — locked to female unless a custom VRM is uploaded */}
      <div>
        <p className="text-[11px] text-text mb-1 flex items-center gap-1">
          <User className="w-3 h-3" /> Suara
        </p>
        <div className="flex gap-1">
          {([['woman', 'Wanita'], ['man', 'Pria']] as ['woman' | 'man', string][]).map(([g, l]) => (
            <button key={g} disabled={!isCustomVrm} onClick={() => setGender(g)}
              className={cn('flex-1 px-2 py-1.5 rounded-lg text-xs font-mono transition-colors border',
                (isCustomVrm ? gender : 'woman') === g ? 'bg-accent/15 text-accent border-accent/40' : 'text-muted border-white/10',
                isCustomVrm ? 'cursor-pointer hover:text-text' : 'opacity-50 cursor-not-allowed')}>
              {l}
            </button>
          ))}
        </div>
        {!isCustomVrm && (
          <p className="text-[10px] text-muted/50 mt-0.5">Karakter bawaan memakai suara perempuan. Upload VRM untuk mengubah.</p>
        )}
      </div>

      {/* Save */}
      <button onClick={save} disabled={!canSave}
        className={cn('w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-mono font-semibold transition-colors',
          canSave ? 'bg-accent text-bg hover:bg-accent/90 cursor-pointer' : 'bg-surface2 text-muted/50 cursor-not-allowed')}>
        {saved ? <><Check className="w-3.5 h-3.5" /> Tersimpan</> : 'Simpan'}
      </button>
      {!canSave && (
        <p className="text-[10px] text-error/80">Nama & Persona wajib diisi.</p>
      )}
    </div>
  )
}
