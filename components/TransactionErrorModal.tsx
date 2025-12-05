"use client";

import { XMarkIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";

type TransactionErrorModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
};

export default function TransactionErrorModal({
  isOpen,
  onClose,
  title,
  message,
}: TransactionErrorModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl border border-rose-500/30 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 shadow-2xl shadow-rose-500/20">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-700/50 hover:text-white"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        {/* Icon */}
        <div className="mb-4 flex items-center justify-center">
          <div className="rounded-full bg-rose-500/20 p-3">
            <ExclamationTriangleIcon className="h-8 w-8 text-rose-400" />
          </div>
        </div>

        {/* Title */}
        <h3 className="mb-3 text-center text-xl font-semibold text-white">
          {title}
        </h3>

        {/* Message */}
        <p className="mb-6 text-center text-sm text-slate-300 leading-relaxed">
          {message}
        </p>

        {/* Action button */}
        <button
          onClick={onClose}
          className="w-full rounded-full bg-gradient-to-r from-rose-500 to-rose-600 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:from-rose-600 hover:to-rose-700 hover:shadow-xl"
        >
          Close
        </button>
      </div>
    </div>
  );
}

