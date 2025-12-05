/**
 * Checks if an error is a user rejection (transaction cancelled by user)
 * @param error - The error object from ethers/wallet
 * @returns true if user rejected, false otherwise
 */
export function isUserRejection(error: any): boolean {
  if (!error) return false;

  // Check error code (MetaMask uses 4001, some wallets use -32603)
  const code = error.code || error.error?.code;
  if (code === 4001 || code === -32603) {
    return true;
  }

  // Check error message for common rejection patterns
  const message = (error.message || error.reason || error.error?.message || "").toLowerCase();
  const rejectionPatterns = [
    "user rejected",
    "user denied",
    "rejected",
    "denied",
    "action rejected",
    "transaction rejected",
    "user cancelled",
    "cancelled",
    "user disapproved",
  ];

  return rejectionPatterns.some((pattern) => message.includes(pattern));
}

/**
 * Beautifies error messages for user display
 * @param error - The error object from ethers/wallet
 * @returns Beautified error message
 */
export function beautifyErrorMessage(error: any): string {
  if (!error) return "An unexpected error occurred. Please try again.";

  const message = error.message || error.reason || error.error?.message || "";
  const code = error.code || error.error?.code;

  // Handle common error patterns
  if (message.toLowerCase().includes("insufficient funds")) {
    return "Insufficient balance. Please ensure you have enough SEI to complete this transaction.";
  }

  if (message.toLowerCase().includes("insufficient balance")) {
    return "Insufficient balance. Please check your wallet and try again.";
  }

  if (message.toLowerCase().includes("gas") || message.toLowerCase().includes("fee")) {
    return "Transaction failed due to gas estimation. Please try again or increase gas limit.";
  }

  if (message.toLowerCase().includes("nonce") || message.toLowerCase().includes("replacement")) {
    return "Transaction conflict detected. Please wait a moment and try again.";
  }

  if (message.toLowerCase().includes("network") || message.toLowerCase().includes("connection")) {
    return "Network error. Please check your connection and try again.";
  }

  if (message.toLowerCase().includes("revert") || message.toLowerCase().includes("execution reverted")) {
    // Try to extract revert reason
    const revertMatch = message.match(/revert\s+(.+)/i) || message.match(/reason:\s*(.+)/i);
    if (revertMatch && revertMatch[1]) {
      const reason = revertMatch[1].trim();
      // Capitalize first letter and add period if needed
      return reason.charAt(0).toUpperCase() + reason.slice(1) + (reason.endsWith(".") ? "" : ".");
    }
    return "Transaction reverted. The operation could not be completed.";
  }

  if (message.toLowerCase().includes("timeout") || message.toLowerCase().includes("deadline")) {
    return "Transaction timed out. Please try again.";
  }

  // Remove technical prefixes and clean up
  let cleaned = message
    .replace(/^Error:\s*/i, "")
    .replace(/^execution reverted:\s*/i, "")
    .replace(/^VM Exception while processing transaction:\s*/i, "")
    .trim();

  // If message is too technical or empty, provide generic message
  if (!cleaned || cleaned.length > 200 || cleaned.includes("0x")) {
    return "Transaction failed. Please check your inputs and try again.";
  }

  // Capitalize first letter
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

  return cleaned;
}

/**
 * Gets a user-friendly error message for transaction errors
 * @param error - The error object from ethers/wallet
 * @returns Object with isRejection flag and beautified message
 */
export function getTransactionError(error: any): { isRejection: boolean; message: string; title: string } {
  if (isUserRejection(error)) {
    return {
      isRejection: true,
      title: "Transaction Rejected",
      message: "You cancelled the transaction. You can try again when ready.",
    };
  }

  return {
    isRejection: false,
    title: "Transaction Failed",
    message: beautifyErrorMessage(error),
  };
}

