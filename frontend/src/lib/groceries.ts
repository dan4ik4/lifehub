import { t } from './language';

// Match ingredient stems at word boundaries so inflected Polish and Russian
// shopping items can be grouped without changing their original names.
const departments = [
  { name: 'Мясо и рыба', stem: /^(куриц|курин|индей|говя|свини|лосос|тунец|мяс|рыб|курча|kurcz|indyk|wolow|wieprz|losos|tuncz|ryb|mies|chicken|turkey|beef|pork|salmon|tuna|meat|fish)/ },
  { name: 'Молочное и яйца', stem: /^(молок|йогурт|яйц|творог|кефир|сыр|сливочн|mlek|jogurt|jaj|twarog|kefir|maslo|milk|yoghur?t|eggs?$|cheese|butter|ser$|sery$|sera$)/ },
  { name: 'Бакалея', stem: /^(фасол|чечевиц|горох|нут$|орех|миндал|грецк|арахис|масл|fasol|soczewic|orzech|migdal|oliw|olej|beans?$|lentils?$|nuts?$|almonds?$|oil$|peanuts?$|walnuts?$)/ },
  { name: 'Крупы и хлеб', stem: /^(овся|круп|рис$|греч|хлеб|макарон|мука|owsian|kasz|ryz$|chleb|makaron|maka$|oats?$|rice$|buckwheat|bread|pasta|flour)/ },
  { name: 'Овощи и фрукты', stem: /^(яблок|банан|авокад|броккол|овощ|томат|помидор|огур|морков|фрукт|карто|салат|ягод|клубник|малин|перец|кабач|jabl|banan|awokad|brokul|warzyw|owoc|pomidor|ogor|marchew|ziemniak|salat|jagod|truskaw|malin|apple|banana|avocado|broccoli|vegetable|tomato|cucumber|carrot|fruit|potato|lettuce|salad|berr(y|ies)|strawberr|raspberr)/ },
];

export function groceryDepartment(title: string): string {
  const normalised = title.normalize('NFC').toLowerCase().replaceAll('ё', 'е')
    .replace(/\p{Script=Latin}+/gu, word => word.normalize('NFD').replace(/\p{M}/gu, '').replaceAll('ł', 'l'));
  const words = normalised.match(/\p{L}+/gu) ?? [];
  return t(departments.find(({ stem }) => words.some(word => stem.test(word)))?.name ?? 'Другие покупки');
}
