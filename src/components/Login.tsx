import { useState } from 'react'
import { AVATAR_COLORS } from '../lib/ids'
import { colorFor, savedUsername, useAppStore } from '../store'

export function Login() {
  const register = useAppStore((s) => s.register)
  const login = useAppStore((s) => s.login)
  const busy = useAppStore((s) => s.authBusy)
  const error = useAppStore((s) => s.authError)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState(() => savedUsername())
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState(() => colorFor(savedUsername() || 'nexo'))

  function submit() {
    const user = username.trim().toLowerCase()
    if (!user || password.length < 6) return
    if (mode === 'login') {
      login(user, password)
      return
    }
    if (password !== confirm) return
    const display = name.trim() || user
    register({ username: user, password, name: display, color })
  }

  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="login-form">
          <h1>{mode === 'login' ? 'Boas-vindas de volta' : 'Criar uma conta'}</h1>
          <p>
            {mode === 'login'
              ? 'Entre para ligar, compartilhar a tela e conversar em particular.'
              : 'Escolha um usuário e uma senha. Depois adicione amigos para ligar.'}
          </p>
          <div className="auth-tabs">
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
              Entrar
            </button>
            <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>
              Criar conta
            </button>
          </div>
          {error ? <div className="auth-error">{error}</div> : null}
          <label htmlFor="user">Nome de usuário</label>
          <input
            id="user"
            autoFocus
            autoComplete="username"
            maxLength={20}
            placeholder="ex.: ana"
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
          />
          {mode === 'register' ? (
            <>
              <label htmlFor="nick">Nome de exibição</label>
              <input
                id="nick"
                maxLength={32}
                placeholder="Como você aparece para os amigos"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </>
          ) : null}
          <label htmlFor="pass">Senha</label>
          <input
            id="pass"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={6}
            placeholder="Mínimo 6 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'register' ? (
            <>
              <label htmlFor="pass2">Confirmar senha</label>
              <input
                id="pass2"
                type="password"
                autoComplete="new-password"
                placeholder="Repita a senha"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {confirm && password !== confirm ? <div className="auth-error">As senhas não coincidem.</div> : null}
              <label>Cor do avatar</label>
              <div className="swatches">
                {AVATAR_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`swatch ${c === color ? 'on' : ''}`}
                    style={{ background: c }}
                    aria-label={c}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </>
          ) : null}
          <button type="submit" disabled={busy || (mode === 'register' && password !== confirm)}>
            {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
          <p className="auth-switch">
            {mode === 'login' ? 'Ainda não tem conta? ' : 'Já tem uma conta? '}
            <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Criar agora' : 'Entrar'}
            </button>
          </p>
        </div>
        <aside className="login-aside">
          <h2>Chamadas só entre amigos</h2>
          <p>Crie duas contas (em abas diferentes), pesquise o usuário e aceite o pedido. Aí a ligação e a tela funcionam.</p>
          <ol>
            <li>Crie a conta A e a conta B</li>
            <li>Em Amigos, busque o usuário e envie o pedido</li>
            <li>Aceite no outro lado e abra o DM</li>
            <li>Clique no telefone e, na chamada, no monitor</li>
          </ol>
        </aside>
      </form>
    </div>
  )
}
