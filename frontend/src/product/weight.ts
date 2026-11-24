import { t } from '../lib/language';
export const displayWeight = (kg: unknown, unit?: string) =>
  Number(kg) * (unit === "lb" ? 2.2046226218487757 : 1);
export const storeWeight = (value: unknown, unit?: string) =>
  (Number(value) / (unit === "lb" ? 2.2046226218487757 : 1)).toFixed(3);
export const weightLabel = (unit?: string) => (unit === "lb" ? t("фунт.") : t("кг"));
