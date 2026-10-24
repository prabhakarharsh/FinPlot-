// shared/constants.js
// Shared categories and keyword rules for FinPilot

export const DEFAULT_CATEGORIES = [
  { name: 'Salary', kind: 'income', color: '#10B981' },
  { name: 'Other Income', kind: 'income', color: '#34D399' },
  { name: 'Rent/Housing', kind: 'expense', color: '#F59E0B' },
  { name: 'Groceries', kind: 'expense', color: '#3B82F6' },
  { name: 'Dining', kind: 'expense', color: '#EC4899' },
  { name: 'Transport', kind: 'expense', color: '#8B5CF6' },
  { name: 'Utilities', dedicate: true, kind: 'expense', color: '#6366F1' },
  { name: 'Subscriptions', kind: 'expense', color: '#F97316' },
  { name: 'Shopping', kind: 'expense', color: '#14B8A6' },
  { name: 'Health', kind: 'expense', color: '#EF4444' },
  { name: 'Entertainment', kind: 'expense', color: '#A855F7' },
  { name: 'Travel', kind: 'expense', color: '#06B6D4' },
  { name: 'Education', kind: 'expense', color: '#4F46E5' },
  { name: 'Insurance', kind: 'expense', color: '#64748B' },
  { name: 'Transfers', kind: 'transfer', color: '#94A3B8' },
  { name: 'Uncategorised', kind: 'expense', color: '#9CA3AF' }
];

export const KEYWORD_RULES = [
  // Income
  { pattern: /salary|payroll|direct dep|wages|employer|stipend|bonus/i, category: 'Salary' },
  { pattern: /dividend|interest cr|cashback|refund|reimbursement|upi in/i, category: 'Other Income' },

  // Rent / Housing
  { pattern: /rent|landlord|prestige|society maintenance|nobroker|nestaway|housing/i, category: 'Rent/Housing' },

  // Groceries
  { pattern: /grocer|supermarket|bigbasket|blinkit|zepto|instamart|dmart|nature's basket|spencer|vegetable|milk|fresh/i, category: 'Groceries' },

  // Dining / Food Delivery
  { pattern: /swiggy|zomato|starbucks|mcdonald|domino|pizza|burger|cafe|restaurant|eatery|diner|barbeque|bistro|food court/i, category: 'Dining' },

  // Transport & Fuel
  { pattern: /uber|ola|rapido|metro|petrol|fuel|diesel|shell|hpcl|bpcl|ioc|toll|fastag|parking|auto/i, category: 'Transport' },

  // Utilities
  { pattern: /bescom|electricity|power|water|gas|indane|airtel|jio|broadband|wifi|vodafone|vi bill|tatasky|dth|cylinder/i, category: 'Utilities' },

  // Subscriptions & Digital
  { pattern: /netflix|spotify|prime video|hotstar|youtube|apple\.com|google play|patreon|github|dropbox|icloud|subscr|chatgpt|openai/i, category: 'Subscriptions' },

  // Shopping / E-commerce
  { pattern: /amazon|flipkart|myntra|zara|h&m|clothing|mall|retail|ikea|croma|reliance digital|tatacliq|nykaa/i, category: 'Shopping' },

  // Health & Wellness
  { pattern: /pharmacy|apollo|1mg|medplus|hospital|clinic|doctor|dental|cult\.fit|cultfit|gym|fitness|lab|diagnostic/i, category: 'Health' },

  // Entertainment
  { pattern: /bookmyshow|pvr|inox|cinema|movie|theatre|gaming|steam|playstation|concert|amusement/i, category: 'Entertainment' },

  // Travel
  { pattern: /makemytrip|cleartrip|goibibo|indigo|air india|vistara|flight|hotel|airbnb|booking\.com|irctc|railway/i, category: 'Travel' },

  // Education
  { pattern: /udemy|coursera|tuition|school|college|university|books|edx|course|exam fee/i, category: 'Education' },

  // Insurance
  { pattern: /lic|insurance|hdfc ergo|icici lombard|star health|max bupa|care health|policybazaar|premium/i, category: 'Insurance' },

  // Transfers
  { pattern: /transfer|self transfer|neft to|imps to|rtgs|ach dr to|to savings|wire transfer/i, category: 'Transfers' }
];

export const ANOMALY_CODES = {
  UNUSUAL_AMOUNT: 'UNUSUAL_AMOUNT',
  NEW_LARGE_MERCHANT: 'NEW_LARGE_MERCHANT',
  POSSIBLE_DUPLICATE: 'POSSIBLE_DUPLICATE',
  PRICE_CHANGE: 'PRICE_CHANGE',
  UNUSUAL_TIMING: 'UNUSUAL_TIMING'
};
