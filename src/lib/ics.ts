// Export de calendário (.ics) — pedido de cliente: o mês de conteúdo já cai direto no
// Google Agenda, no horário sugerido pela IA para cada post.

export interface IcsEvent {
  uid: string
  start: Date
  durationMinutes: number
  summary: string
  description: string
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Hora local "flutuante" (sem Z/TZID): mais simples que embutir um VTIMEZONE, e os apps de
// calendário interpretam usando o fuso do próprio usuário — correto pro caso de uso.
function formatIcsLocal(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
}

function formatIcsUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

// RFC 5545: linhas com mais de 75 octetos devem ser dobradas (continuação começa com espaço).
function foldLine(line: string): string {
  if (line.length <= 75) return line
  let result = line.slice(0, 75)
  let rest = line.slice(75)
  while (rest.length > 0) {
    result += '\r\n ' + rest.slice(0, 74)
    rest = rest.slice(74)
  }
  return result
}

export function buildIcsCalendar(events: IcsEvent[]): string {
  const now = new Date()
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VoiceFlow IA//Calendario de Conteudo//PT',
    'CALSCALE:GREGORIAN',
  ]
  for (const ev of events) {
    const end = new Date(ev.start.getTime() + ev.durationMinutes * 60000)
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${ev.uid}`)
    lines.push(`DTSTAMP:${formatIcsUtc(now)}`)
    lines.push(`DTSTART:${formatIcsLocal(ev.start)}`)
    lines.push(`DTEND:${formatIcsLocal(end)}`)
    lines.push(foldLine(`SUMMARY:${escapeIcsText(ev.summary)}`))
    lines.push(foldLine(`DESCRIPTION:${escapeIcsText(ev.description)}`))
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

export function downloadIcsFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// "Dia N" (1-indexado) + "HH:MM" sugerido -> Date real, a partir da data de início escolhida.
export function postDateTime(startDate: Date, dia: number, horario: string): Date {
  const [h, m] = horario.split(':').map(Number)
  const d = new Date(startDate)
  d.setDate(d.getDate() + (dia - 1))
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}
