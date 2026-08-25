type Listener = (open: boolean) => void

const listeners = new Set<Listener>()
let open = false

export function isScreenSharePickerOpen() {
  return open
}

export function openScreenSharePicker() {
  open = true
  for (const fn of listeners) fn(true)
}

export function closeScreenSharePicker() {
  open = false
  for (const fn of listeners) fn(false)
}

export function subscribeScreenSharePicker(fn: Listener) {
  listeners.add(fn)
  fn(open)
  return () => {
    listeners.delete(fn)
  }
}

/** Abre o seletor; se já estiver compartilhando, para. */
export function requestScreenShareToggle(screenOn: boolean, stop: () => void) {
  if (screenOn) stop()
  else openScreenSharePicker()
}
