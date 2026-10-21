/* global jest */
// Jest stand-in for react-native-purchases (RevenueCat): no native module exists under Jest,
// and the real SDK would try to start its browser fallback. Tests that need behaviour give
// createStoreBilling a fake SDK; this keeps every other import of the package inert.
const LOG_LEVEL = { VERBOSE: "VERBOSE", DEBUG: "DEBUG", INFO: "INFO", WARN: "WARN", ERROR: "ERROR" };

const PURCHASES_ERROR_CODE = {
  UNKNOWN_ERROR: "0",
  PURCHASE_CANCELLED_ERROR: "1",
  STORE_PROBLEM_ERROR: "2",
  PURCHASE_NOT_ALLOWED_ERROR: "3",
  PURCHASE_INVALID_ERROR: "4",
  PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR: "5",
  PRODUCT_ALREADY_PURCHASED_ERROR: "6",
  RECEIPT_ALREADY_IN_USE_ERROR: "7",
  NETWORK_ERROR: "10",
  RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR: "13",
  PAYMENT_PENDING_ERROR: "20",
  OFFLINE_CONNECTION_ERROR: "35",
};

const EMPTY_INFO = { entitlements: { active: {}, all: {} }, activeSubscriptions: [], managementURL: null };

const Purchases = {
  configure: jest.fn(),
  isConfigured: jest.fn(async () => false),
  logIn: jest.fn(async () => ({ customerInfo: EMPTY_INFO, created: false })),
  logOut: jest.fn(async () => EMPTY_INFO),
  getOfferings: jest.fn(async () => ({ all: {}, current: null })),
  purchasePackage: jest.fn(async () => ({ customerInfo: EMPTY_INFO })),
  restorePurchases: jest.fn(async () => EMPTY_INFO),
  getCustomerInfo: jest.fn(async () => EMPTY_INFO),
  addCustomerInfoUpdateListener: jest.fn(),
  removeCustomerInfoUpdateListener: jest.fn(() => true),
  setLogLevel: jest.fn(async () => {}),
};

module.exports = { __esModule: true, default: Purchases, LOG_LEVEL, PURCHASES_ERROR_CODE };
