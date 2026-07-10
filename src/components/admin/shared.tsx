export const inputClass =
  'w-full p-2.5 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-[#8B5CF6] text-sm'

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
    </div>
  )
}
