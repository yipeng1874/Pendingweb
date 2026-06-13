export function FeedbackMessage({ message, error }: { message?: string; error?: string }) {
  if (!message && !error) return null;
  return (
    <div className={`rounded-[18px] border px-4 py-3 text-sm leading-6 shadow-[0_8px_20px_rgba(15,23,42,0.04)] ${error ? "border-red-100 bg-red-50 text-red-600" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>
      {error || message}
    </div>
  );
}
