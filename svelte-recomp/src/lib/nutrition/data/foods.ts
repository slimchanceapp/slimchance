// Built-in generic foods — the things a database of PACKAGED products can't
// answer: "rice", "rožok", "2 eggs", "bryndzové halušky", "0,5 pivo".
//
// Open Food Facts is barcodes and brands. Search it for "rice" and you get forty
// branded bags; search "rozok" and you get nothing at all (it indexes "rožok"
// with the diacritic and doesn't fold it). This list is instant, offline, and
// matches without diacritics. Names cover English, Slovak and Czech, because
// that is what gets typed here.
//
// Values are per 100 g — per 100 ml for drinks. Generic foods follow USDA
// FoodData Central (SR Legacy / FNDDS); Slovak, Czech and Indian dishes are
// typical-recipe averages and vary by cook, so treat them as a good first
// guess. Fast-food items use the chains' published EU figures, rounded.
//
// Row: [name, aliases, kcal, protein g, carbs g, fat g, servings "label=grams; …", liquid?]
// The FIRST serving is the default portion for "2 rožky", "an egg", etc. A
// trailing 1 marks a drink: its numbers are per 100 ml and servings are ml.

export interface BaseFood {
  name: string;
  /** Lower-case alternative names, incl. plurals: "rožok, rožky, rohlík". */
  aliases: string[];
  kcal: number; protein_g: number; carbs_g: number; fat_g: number;
  servings: Array<{ label: string; g: number }>;
  /** Liquid: grams in a serving are millilitres. */
  ml?: boolean;
}

type Row = [string, string, number, number, number, number, string, 1?];

const ROWS: Row[] = [
  // ── Grains, bread, sides ────────────────────────────────────────────────
  ['Rice, white, cooked', 'ryža, ryža varená, rýže, rýže vařená, chawal, white rice, cooked rice', 130, 2.7, 28.2, 0.3, 'portion=200; cup=160'],
  ['Basmati rice, cooked', 'basmati, basmati ryža, basmati rýže', 130, 2.9, 28.4, 0.4, 'portion=200; cup=160'],
  ['Rice, uncooked', 'ryža surová, rýže syrová, dry rice, raw rice', 360, 6.6, 79.3, 0.6, 'portion=75'],
  ['Brown rice, cooked', 'hnedá ryža, natural rice, celozrnná ryža', 123, 2.7, 25.6, 1.0, 'portion=200'],
  ['Pasta, cooked', 'cestoviny, cestoviny varené, těstoviny, spaghetti, špagety, penne', 158, 5.8, 30.9, 0.9, 'portion=220'],
  ['Pasta, dry', 'cestoviny suché, těstoviny suché', 371, 13, 75, 1.5, 'portion=80'],
  ['Couscous, cooked', 'kuskus', 112, 3.8, 23.2, 0.2, 'portion=200'],
  ['Quinoa, cooked', 'quinoa, quinoa varená', 120, 4.4, 21.3, 1.9, 'portion=185'],
  ['Bread, white', 'biely chlieb, bílý chléb, white bread, chlieb', 266, 8.9, 49, 3.3, 'slice=30'],
  ['Bread, Slovak rye-wheat (konzumný)', 'chlieb, konzumný chlieb, ražný chlieb, kmeňový chlieb, chléb, žitný chléb, rye bread', 240, 8, 48, 1.5, 'slice=40'],
  ['Bread, wholegrain', 'celozrnný chlieb, celozrnný chléb, wholemeal bread', 250, 9.7, 43, 3.4, 'slice=40'],
  ['Toast bread', 'toastový chlieb, toastový chléb, toast', 270, 8, 49, 4, 'slice=25'],
  ['Rožok (bread roll)', 'rožok, rožky, rohlík, rohlíky, bread roll', 290, 9, 57, 3, 'piece=43'],
  ['Žemľa / kaiser roll', 'žemľa, žemle, houska, housky, kaiserka, kaiser roll, bun', 280, 9, 56, 2.5, 'piece=50'],
  ['Croissant', 'croissant, croissanty, kruasán, gipsy', 406, 8.2, 45.8, 21, 'piece=60'],
  ['Bagel', 'bagel, bagely', 250, 10, 49, 1.5, 'piece=100'],
  ['Tortilla wrap', 'tortilla, wrap', 310, 8.5, 52, 7.5, 'piece=60'],
  ['Oats, rolled (dry)', 'ovsené vločky, ovesné vločky, oats, oatmeal, porridge oats, vločky', 379, 13.2, 67.7, 6.5, 'portion=50'],
  ['Muesli', 'müsli, musli, granola', 370, 10, 64, 6, 'portion=50'],
  ['Cornflakes', 'cornflakes, kukuričné lupienky', 357, 7.5, 84, 0.4, 'portion=40'],
  ['Potatoes, boiled', 'zemiaky, zemiaky varené, brambory, brambory vařené, boiled potatoes, potato', 87, 1.9, 20.1, 0.1, 'portion=250; piece=150'],
  ['Mashed potatoes', 'zemiaková kaša, bramborová kaše, mashed potato', 105, 2, 15, 4.2, 'portion=250'],
  ['French fries', 'hranolky, hranolčeky, fries, chips', 312, 3.4, 41, 15, 'medium=115; small=80; large=150'],
  ['Sweet potato, baked', 'batáty, sladké zemiaky, sweet potato', 90, 2, 20.7, 0.2, 'piece=150'],
  ['Bread dumpling (knedľa)', 'knedľa, knedle, knedlík, knedlíky, houskový knedlík', 230, 7.5, 45, 1.6, 'slice=40; portion=160'],
  ['Halušky, plain', 'halušky, gnocchi', 160, 3.5, 33, 1.5, 'portion=250'],
  ['Pancake (palacinka)', 'palacinka, palacinky, palačinka, palačinky, crepe, pancake', 227, 6.4, 28.3, 9.7, 'piece=60'],
  ['Naan', 'naan, nan, garlic naan', 290, 8.7, 50, 6, 'piece=90'],
  ['Chapati / roti', 'chapati, roti, phulka, chapatti', 299, 9.6, 46.4, 9.2, 'piece=40'],
  ['Paratha', 'paratha, parotta, parata', 326, 6.4, 45.4, 13.2, 'piece=80'],
  ['Dosa, plain', 'dosa, dosai, dosas', 168, 3.9, 27, 4.9, 'piece=120'],
  ['Idli', 'idli, idlis', 132, 4.3, 26, 0.4, 'piece=40'],
  ['Poha', 'poha, aval', 130, 2.5, 23, 3.5, 'portion=200'],
  ['Upma', 'upma, uppittu', 150, 3.5, 22, 5.5, 'portion=200'],

  // ── Dishes: Slovak & Czech ─────────────────────────────────────────────
  ['Bryndzové halušky (with bacon)', 'bryndzové halušky, bryndzove halusky, halušky s bryndzou', 230, 7.5, 26, 11, 'plate=350'],
  ['Strapačky (sauerkraut dumplings)', 'strapačky, strapacky, halušky s kapustou', 190, 5, 28, 6.5, 'plate=350'],
  ['Kapustnica (sauerkraut soup)', 'kapustnica, kapustová polievka, zelňačka', 75, 4, 4, 5, 'bowl=300', 1],
  ['Goulash soup', 'gulášová polievka, gulášovka, gulášová polévka', 70, 5, 5, 3.5, 'bowl=300', 1],
  ['Beef goulash (no side)', 'guláš, hovädzí guláš, hovězí guláš, goulash', 150, 13, 5, 8.5, 'portion=250'],
  ['Segedin goulash', 'segedínsky guláš, segedínský guláš, segedín', 120, 9, 4, 7.5, 'portion=250'],
  ['Svíčková (beef in cream sauce)', 'sviečková, svíčková, sviečková na smotane', 150, 10, 9, 8, 'portion=300'],
  ['Chicken paprikash (no side)', 'kurací paprikáš, kuřecí paprikáš, paprikáš, paprikash', 140, 13, 4, 8, 'portion=300'],
  ['Fried cheese (vyprážaný syr)', 'vyprážaný syr, smažený sýr, syr vyprážaný', 330, 17, 18, 21, 'piece=150'],
  ['Pork schnitzel, breaded', 'rezeň, vyprážaný rezeň, bravčový rezeň, řízek, smažený řízek, schnitzel', 260, 18, 13, 15, 'piece=150'],
  ['Chicken schnitzel, breaded', 'kurací rezeň, kuřecí řízek, chicken schnitzel', 240, 20, 12, 12, 'piece=150'],
  ['Potato salad (mayo)', 'zemiakový šalát, bramborový salát, potato salad', 160, 2, 13, 11, 'portion=200'],
  ['Langoš (plain)', 'langoš, langos, langoše', 330, 6.5, 40, 16, 'piece=200'],
  ['Lokša', 'lokša, lokše', 240, 5, 42, 6, 'piece=80'],
  ['Pirohy (with bryndza)', 'pirohy, pierogi, piroh', 200, 7, 30, 6, 'portion=300'],
  ['Bean soup', 'fazuľová polievka, fazolová polévka, bean soup', 80, 4.5, 9, 3, 'bowl=300', 1],
  ['Lentil soup', 'šošovicová polievka, čočková polévka, lentil soup', 70, 4.5, 10, 1.5, 'bowl=300', 1],
  ['Chicken broth with noodles', 'slepačí vývar, vývar, kurací vývar, chicken soup, slepičí vývar', 30, 2.5, 2.5, 1, 'bowl=300', 1],
  ['Cream soup (potato/vegetable)', 'krémová polievka, zemiakový krém, polievka, polévka, soup', 70, 1.8, 7.5, 3.8, 'bowl=250', 1],
  ['Chicken risotto', 'rizoto, kuracie rizoto, risotto', 140, 8, 18, 4, 'plate=350'],
  ['Pizza (margherita-style)', 'pizza, pizze, margherita', 250, 10.5, 31, 9, 'slice=110; whole=450'],
  ['Döner kebab in bread', 'kebab, döner, doner, kebap, gyros', 215, 12, 20, 9.5, 'piece=350'],
  ['Kebab box (meat + fries)', 'kebab box, kebabbox, döner box', 230, 11, 18, 13, 'box=450'],
  ['Hot dog (párok v rožku)', 'párok v rožku, hot dog, hotdog, párek v rohlíku', 270, 9.5, 25, 14.5, 'piece=150'],
  ['Koláč / buchta', 'koláč, koláče, buchta, buchty, sweet bun', 320, 7, 50, 10, 'piece=80'],
  ['Poppy seed / walnut roll', 'makovník, orechovník, makovec, poppy seed roll, nut roll', 380, 8, 50, 16, 'slice=60'],
  ['Strudel (apple)', 'štrúdľa, závin, jablkový závin, strudel', 260, 3, 36, 11, 'slice=100'],

  // ── Dishes: Indian ─────────────────────────────────────────────────────
  ['Dal (lentil curry)', 'dal, daal, dhal, dal tadka, dal fry, lentil curry', 115, 6, 15, 3.5, 'bowl=250'],
  ['Sambar', 'sambar, sambhar', 65, 3, 8, 2.5, 'bowl=250'],
  ['Chicken curry (home-style)', 'chicken curry, kuracie kari, kuřecí kari, murgh curry', 140, 13, 4, 8, 'portion=300'],
  ['Chicken tikka masala', 'tikka masala, chicken tikka masala, cmt', 135, 11, 6, 7.5, 'portion=350'],
  ['Butter chicken', 'butter chicken, murgh makhani, makhani', 150, 11, 6, 9.5, 'portion=350'],
  ['Chicken saag / palak chicken', 'saag chicken, chicken saag, palak chicken', 120, 12, 4, 6.5, 'portion=300'],
  ['Palak paneer', 'palak paneer, saag paneer', 155, 7, 6, 11.5, 'portion=250'],
  ['Chana masala', 'chana masala, chole, chickpea curry', 125, 6, 15, 4.5, 'portion=250'],
  ['Rajma', 'rajma, kidney bean curry', 115, 6, 15, 3.5, 'portion=250'],
  ['Egg curry', 'egg curry, anda curry', 140, 8, 5, 10, 'portion=250'],
  ['Chicken biryani', 'biryani, chicken biryani, biriyani', 165, 9, 20, 5.5, 'plate=350'],
  ['Tamarind rice (puliyogare)', 'puliyogare, puliyodharai, tamarind rice', 180, 3.2, 30, 5.5, 'plate=250'],
  ['Masala dosa', 'masala dosa', 190, 4, 28, 7, 'piece=200'],
  ['Samosa (potato)', 'samosa, samosy', 260, 5, 30, 13.5, 'piece=80'],
  ['Raita', 'raita, cucumber raita', 60, 3, 5, 3, 'bowl=150'],
  ['Paneer', 'paneer, panir', 296, 18.9, 3.6, 23, 'portion=100'],
  ['Ghee', 'ghee, clarified butter', 900, 0, 0, 99.8, 'tbsp=13; tsp=5'],
  ['Indian pickle (in oil)', 'achar, achaar, pickle, mango pickle, brinjal pickle, lime pickle', 230, 1.5, 7, 22, 'tbsp=15'],

  // ── Meat, fish, eggs ───────────────────────────────────────────────────
  ['Chicken breast, raw', 'kuracie prsia, kuracie prsia surové, kuřecí prsa, chicken breast raw', 120, 22.5, 0, 2.6, 'piece=200'],
  ['Chicken breast, cooked', 'kuracie prsia pečené, grilované kuracie prsia, kuřecí prsa grilovaná, grilled chicken, chicken breast', 165, 31, 0, 3.6, 'portion=150'],
  ['Chicken thigh, cooked (skinless)', 'kuracie stehno, kuracie stehná, kuřecí stehno, chicken thigh', 209, 26, 0, 10.9, 'piece=110'],
  ['Chicken thigh, raw (skinless)', 'kuracie stehná surové, chicken thigh raw', 121, 19.7, 0, 4.1, 'piece=120'],
  ['Chicken drumstick, cooked', 'kuracie paličky, palička, paličky, drumstick, drumsticks', 216, 27, 0, 11.2, 'piece=75'],
  ['Chicken wings, cooked', 'kuracie krídla, krídelká, kuřecí křídla, wings, chicken wings', 290, 27, 0, 19.5, 'piece=35'],
  ['Chicken nuggets', 'nugety, nuggets, chicken nuggets, stripsy, chicken strips, tenders', 296, 15, 15, 20, 'piece=17'],
  ['Chicken liver, cooked', 'kuracia pečeň, kuřecí játra, chicken liver', 167, 24.5, 0.9, 6.5, 'portion=150'],
  ['Turkey breast, cooked', 'morčacie prsia, krůtí prsa, turkey', 147, 30, 0, 2, 'portion=150'],
  ['Pork tenderloin, cooked', 'bravčová panenka, vepřová panenka, pork tenderloin', 143, 26, 0, 3.5, 'portion=150'],
  ['Pork neck, grilled', 'krkovička, krkovice, bravčová krkovička, pork neck', 260, 25, 0, 17.5, 'portion=150'],
  ['Bacon, fried', 'slanina, slaninka, opekaná slanina, bacon', 540, 37, 1.4, 42, 'slice=10'],
  ['Beef mince 20%, raw', 'mleté hovädzie, mleté mäso, mleté maso, hovězí mleté, minced beef, ground beef', 254, 17.2, 0, 20, 'portion=125'],
  ['Beef mince 20%, cooked', 'mleté mäso pečené, cooked mince', 272, 25.6, 0, 18, 'portion=125'],
  ['Beef steak, cooked', 'hovädzí steak, steak, hovězí steak, sirloin', 200, 29, 0, 9, 'piece=200'],
  ['Ham, cooked (šunka)', 'šunka, sunka, dusená šunka, šunka výberová, ham', 110, 18, 1.5, 3.5, 'slice=20'],
  ['Salami', 'saláma, salám, salami, pepperoni', 450, 22, 1.5, 39, 'slice=8'],
  ['Frankfurters (párky)', 'párky, párok, párek, frankfurter, sausages', 270, 12, 2, 24, 'piece=50'],
  ['Sausage (klobása)', 'klobása, klobása grilovaná, klobasa, kielbasa', 320, 15, 1.5, 28, 'piece=100'],
  ['Salmon, cooked', 'losos, salmon', 206, 22, 0, 12.4, 'fillet=125'],
  ['Tuna in water, drained', 'tuniak, tuniak vo vlastnej šťave, tuňák ve vlastní šťávě, tuna', 116, 26, 0, 1, 'can=120'],
  ['Tuna in oil, drained', 'tuniak v oleji, tuňák v oleji, tuna in oil', 198, 29, 0, 8.2, 'can=120'],
  ['White fish (cod), cooked', 'treska, filé, rybie filé, cod, fish fillet', 105, 23, 0, 0.9, 'fillet=150'],
  ['Prawns, cooked', 'krevety, krevetky, prawns, shrimp', 99, 24, 0.2, 0.3, 'portion=100'],
  ['Egg', 'vajce, vajcia, vajíčko, vajíčka, vejce, vajce varené, boiled egg, eggs', 143, 12.6, 0.7, 9.5, 'piece=55'],
  ['Egg white', 'bielok, bielky, bílek, egg whites', 52, 10.9, 0.7, 0.2, 'piece=33'],
  ['Omelette', 'omeleta, omelet, omelette', 154, 10.6, 0.6, 11.7, 'portion=150'],
  ['Scrambled eggs', 'praženica, míchaná vejce, scrambled eggs', 149, 10, 1.6, 11, 'portion=150'],
  ['Tofu, firm', 'tofu', 144, 15.8, 2.8, 8.7, 'portion=100'],

  // ── Protein products ───────────────────────────────────────────────────
  ['Whey protein powder', 'whey, protein, proteín, srvátkový proteín, protein powder, scoop', 390, 78, 8, 6, 'scoop=30'],
  ['Casein protein powder', 'kazeín, casein', 360, 78, 6, 1.5, 'scoop=30'],
  ['Protein bar', 'proteínová tyčinka, protein bar, proteinová tyčinka', 380, 30, 35, 13, 'bar=60'],
  ['Protein pudding', 'proteínový puding, protein pudding, high protein pudding', 75, 10, 6, 1.5, 'cup=200'],

  // ── Dairy ──────────────────────────────────────────────────────────────
  ['Milk, whole 3.5%', 'mlieko, plnotučné mlieko, mléko, plnotučné mléko, milk, whole milk', 64, 3.3, 4.7, 3.5, 'glass=250; splash=30', 1],
  ['Milk, semi-skimmed 1.5%', 'polotučné mlieko, polotučné mléko, semi skimmed milk', 46, 3.4, 4.8, 1.5, 'glass=250; splash=30', 1],
  ['Milk, skimmed 0.5%', 'odtučnené mlieko, odtučněné mléko, skim milk', 35, 3.5, 4.9, 0.3, 'glass=250', 1],
  ['Kefir', 'kefír, kefir, acidko, zakysanka', 50, 3.3, 4.2, 2, 'cup=250', 1],
  ['Yogurt, plain 3%', 'biely jogurt, bílý jogurt, jogurt, plain yogurt, yoghurt', 66, 4, 5, 3.3, 'cup=150'],
  ['Greek yogurt 10%', 'grécky jogurt, grecky jogurt, řecký jogurt, greek yogurt, greek style yogurt', 123, 4, 3.7, 10, 'cup=150'],
  ['Greek yogurt 0%', 'grécky jogurt 0%, řecký jogurt 0%, fat free greek yogurt', 57, 10, 3.6, 0.4, 'cup=150'],
  ['Skyr', 'skyr', 63, 11, 4, 0.2, 'cup=150'],
  ['Quark, fat-free (tvaroh)', 'tvaroh, tvaroh odtučnený, tvaroh netučný, tvaroh odtučněný, nízkotučný tvaroh, quark, magertopfen', 67, 12, 4, 0.5, 'pack=250'],
  ['Quark, half-fat (tvaroh)', 'tvaroh polotučný, polotučný tvaroh', 95, 11, 3.8, 4, 'pack=250'],
  ['Quark, full-fat (tvaroh)', 'tvaroh tučný, plnotučný tvaroh, tvaroh plnotučný', 168, 13.5, 3.5, 11, 'pack=250'],
  ['Cottage cheese', 'cottage, cottage cheese, žervé', 98, 11.1, 3.4, 4.3, 'cup=180'],
  ['Bryndza', 'bryndza, sheep cheese', 280, 16, 1.5, 23, 'portion=50'],
  ['Edam 30% (eidam)', 'eidam, eidam 30, edam, syr, sýr, cheese', 265, 28, 1, 16, 'slice=20'],
  ['Gouda / Edam 45%', 'gouda, eidam 45, eidam 45%, ementál, emmental', 356, 25, 2.2, 27.4, 'slice=20'],
  ['Mozzarella', 'mozzarella', 250, 18, 1, 19, 'ball=125'],
  ['Slovak sheep string cheese', 'parenica, parenice, korbáčik, korbáčiky, oštiepok, ostiepok', 290, 23, 1, 22, 'portion=100'],
  ['Hermelín / camembert', 'hermelín, camembert, plesňový syr', 300, 20, 0.5, 24, 'piece=120'],
  ['Feta', 'feta, balkánsky syr, balkánský sýr', 264, 14.2, 4, 21.3, 'portion=50'],
  ['Parmesan', 'parmezán, parmesan, grana padano', 431, 38, 4, 29, 'tbsp=5'],
  ['Processed cheese', 'tavený syr, tavený sýr, tavenec, processed cheese', 230, 12, 5, 18, 'portion=25'],
  ['Cream cheese', 'lučina, žervé krémové, philadelphia, cream cheese, smotanový syr', 240, 6, 3.5, 23, 'portion=30'],
  ['Butter', 'maslo, máslo, butter', 717, 0.9, 0.1, 81, 'portion=10; tbsp=14'],
  ['Cream 33%', 'šľahačka, smotana na šľahanie, smetana ke šlehání, cream, whipping cream', 320, 2, 3, 33, 'tbsp=15'],
  ['Sour cream 14%', 'kyslá smotana, zakysaná smetana, sour cream', 160, 2.8, 3.6, 14, 'tbsp=20'],

  // ── Fruit & vegetables ─────────────────────────────────────────────────
  ['Banana', 'banán, banány, banan, bananas', 89, 1.1, 22.8, 0.3, 'piece=120'],
  ['Apple', 'jablko, jablká, jablka, apples', 52, 0.3, 13.8, 0.2, 'piece=180'],
  ['Orange', 'pomaranč, pomaranče, pomeranč, oranges', 47, 0.9, 11.8, 0.1, 'piece=150'],
  ['Mandarin', 'mandarínka, mandarínky, mandarinka, clementine', 53, 0.8, 13.3, 0.3, 'piece=75'],
  ['Pear', 'hruška, hrušky, pears', 57, 0.4, 15.2, 0.1, 'piece=180'],
  ['Grapes', 'hrozno, hroznové víno, hrozny, grapes', 69, 0.7, 18.1, 0.2, 'bunch=150'],
  ['Blueberries', 'čučoriedky, borůvky, blueberries, myrtilles', 57, 0.7, 14.5, 0.3, 'cup=150'],
  ['Strawberries', 'jahody, strawberries', 32, 0.7, 7.7, 0.3, 'cup=150'],
  ['Raspberries', 'maliny, raspberries', 52, 1.2, 11.9, 0.7, 'cup=125'],
  ['Mango', 'mango', 60, 0.8, 15, 0.4, 'piece=200'],
  ['Kiwi', 'kiwi', 61, 1.1, 14.7, 0.5, 'piece=75'],
  ['Watermelon', 'melón, vodný melón, meloun, watermelon', 30, 0.6, 7.6, 0.2, 'slice=300'],
  ['Plums', 'slivky, švestky, plums', 46, 0.7, 11.4, 0.3, 'piece=60'],
  ['Pineapple', 'ananás, pineapple', 50, 0.5, 13.1, 0.1, 'slice=80'],
  ['Raisins', 'hrozienka, rozinky, sultánky, sultanas, raisins', 299, 3.1, 79, 0.5, 'tbsp=15'],
  ['Dates', 'datle, datľa, dates', 282, 2.5, 75, 0.4, 'piece=8'],
  ['Avocado', 'avokádo, avocado', 160, 2, 8.5, 14.7, 'piece=150'],
  ['Tomato', 'paradajka, paradajky, rajče, rajčata, tomato, tomatoes', 18, 0.9, 3.9, 0.2, 'piece=120'],
  ['Cucumber', 'uhorka, uhorky, okurka, cucumber', 15, 0.7, 3.6, 0.1, 'piece=300'],
  ['Bell pepper', 'paprika, papriky, pepper, capsicum', 26, 1, 6, 0.3, 'piece=150'],
  ['Onion', 'cibuľa, cibule, onion', 40, 1.1, 9.3, 0.1, 'piece=110'],
  ['Carrot', 'mrkva, mrkev, carrot, carrots', 41, 0.9, 9.6, 0.2, 'piece=60'],
  ['Broccoli', 'brokolica, brokolice, broccoli', 34, 2.8, 6.6, 0.4, 'portion=150'],
  ['Cauliflower', 'karfiol, květák, cauliflower', 25, 1.9, 5, 0.3, 'portion=150'],
  ['Spinach', 'špenát, spinach, palak', 23, 2.9, 3.6, 0.4, 'portion=100'],
  ['Green beans', 'zelené fazuľky, fazolky, green beans', 31, 1.8, 7, 0.2, 'portion=150'],
  ['Mixed salad leaves', 'šalát, zeleninový šalát, salát, salad, lettuce', 15, 1.4, 2.9, 0.2, 'bowl=100'],
  ['Sauerkraut', 'kyslá kapusta, kysané zelí, sauerkraut', 19, 0.9, 4.3, 0.1, 'portion=150'],
  ['Sweet corn', 'kukurica, kukuřice, corn', 81, 2.6, 19, 1.2, 'portion=100'],
  ['Chickpeas, cooked', 'cícer, cizrna, chickpeas, chana', 164, 8.9, 27.4, 2.6, 'portion=150'],
  ['Lentils, cooked', 'šošovica, čočka, lentils', 116, 9, 20, 0.4, 'portion=150'],
  ['Kidney beans, cooked', 'fazuľa, fazole, beans, kidney beans', 127, 8.7, 22.8, 0.5, 'portion=150'],
  ['Edamame', 'edamame', 121, 11.9, 8.9, 5.2, 'portion=100'],

  // ── Nuts, snacks, sweets ───────────────────────────────────────────────
  ['Almonds', 'mandle, almonds', 579, 21.2, 21.6, 49.9, 'handful=30'],
  ['Peanuts, roasted', 'arašidy, burské oriešky, arašídy, peanuts', 585, 24, 21, 49.7, 'handful=30'],
  ['Cashews', 'kešu, kešu oriešky, cashews', 553, 18.2, 30.2, 43.9, 'handful=30'],
  ['Walnuts', 'vlašské orechy, orechy, vlašské ořechy, walnuts', 654, 15.2, 13.7, 65.2, 'handful=30'],
  ['Peanut butter', 'arašidové maslo, arašídové máslo, peanut butter', 588, 25, 20, 50, 'tbsp=16'],
  ['Potato chips', 'čipsy, chipsy, lupienky, brambůrky, crisps, potato chips', 536, 7, 53, 34.6, 'bag=70; small bag=30'],
  ['Popcorn', 'pukance, popcorn', 480, 9, 60, 22, 'bag=90'],
  ['Rice cakes', 'ryžové chlebíky, rýžové chlebíčky, rice cakes', 387, 8, 81, 2.8, 'piece=9'],
  ['Milk chocolate', 'mliečna čokoláda, mléčná čokoláda, čokoláda, milka, chocolate', 535, 7.7, 59.4, 29.7, 'row=25; bar=100'],
  ['Dark chocolate 70%', 'horká čokoláda, hořká čokoláda, dark chocolate', 580, 8, 46, 42, 'row=20; bar=100'],
  ['Nutella', 'nutella, nugátový krém', 539, 6.3, 57.5, 30.9, 'tbsp=15'],
  ['Snickers', 'snickers', 488, 7.5, 60, 24, 'bar=50'],
  ['Wafer bar (Horalky)', 'horalky, horalka, oplátky, oplatky, deli, wafer', 525, 6.5, 60, 28, 'bar=50'],
  ['Biscuits', 'sušienky, sušenky, keksy, biscuits, cookies', 480, 6.5, 68, 20, 'piece=10'],
  ['Ice cream', 'zmrzlina, ice cream', 207, 3.5, 23.6, 11, 'scoop=65'],
  ['Donut', 'šiška, šišky, kobliha, donut, doughnut', 421, 5, 51, 23, 'piece=60'],
  ['Muffin', 'muffin, muffiny', 377, 5.5, 51, 17, 'piece=90'],
  ['Cake (slice)', 'torta, dort, zákusok, cake', 350, 4.5, 47, 16, 'slice=100'],
  ['Chocolate croissant', 'čokoládový croissant, pain au chocolat', 420, 7.5, 46, 23, 'piece=70'],
  ['Honey', 'med, honey', 304, 0.3, 82, 0, 'tsp=7; tbsp=21'],
  ['Jam', 'džem, lekvár, marmeláda, jam', 250, 0.4, 62, 0.1, 'tbsp=20'],
  ['Sugar', 'cukor, cukr, sugar', 400, 0, 100, 0, 'tsp=4'],
  ['Olive oil', 'olivový olej, olej, oil, olive oil, slnečnicový olej', 884, 0, 0, 100, 'tbsp=13; tsp=5'],
  ['Mayonnaise', 'majonéza, majolka, mayo, mayonnaise', 680, 1, 0.6, 75, 'tbsp=15'],
  ['Ketchup', 'kečup, ketchup', 112, 1.2, 26, 0.2, 'tbsp=15'],
  ['Garlic sauce', 'cesnaková omáčka, česneková omáčka, garlic sauce, garlic mayo', 450, 1.5, 6, 47, 'portion=40'],

  // ── Drinks (per 100 ml) ────────────────────────────────────────────────
  ['Beer, 10° lager', 'pivo, pivo 10, desiatka, desítka, gambrinus, beer, lager', 37, 0.4, 3.5, 0, '0.5 l=500; 0.3 l=300', 1],
  ['Beer, 12° lager (Pilsner)', 'pivo 12, dvanástka, dvanáctka, plzeň, pilsner, pilsner urquell, urquell', 43, 0.5, 3.8, 0, '0.5 l=500; 0.3 l=300', 1],
  ['Non-alcoholic beer', 'nealko pivo, nealko, birell, non-alcoholic beer', 26, 0.3, 5.8, 0, '0.5 l=500', 1],
  ['Wine, red', 'červené víno, víno, red wine, wine', 85, 0.1, 2.6, 0, 'glass=150', 1],
  ['Wine, white', 'biele víno, bílé víno, white wine', 82, 0.1, 2.6, 0, 'glass=150', 1],
  ['Spirits 40% (vodka, borovička)', 'vodka, borovička, slivovica, slivovice, rum, whisky, gin, tequila, panák', 231, 0, 0, 0, 'shot=40', 1],
  ['Kofola', 'kofola', 32, 0, 8, 0, '0.5 l=500; glass=300', 1],
  ['Cola', 'cola, coca cola, coca-cola, pepsi', 42, 0, 10.6, 0, 'can=330; 0.5 l=500', 1],
  ['Cola zero', 'cola zero, coke zero, pepsi max, diet cola', 0.3, 0, 0, 0, 'can=330; 0.5 l=500', 1],
  ['Orange juice', 'pomarančový džús, pomerančový džus, juice, džús, orange juice', 45, 0.7, 10.4, 0.2, 'glass=250', 1],
  ['Energy drink', 'energetický nápoj, red bull, monster, energy drink', 45, 0, 11, 0, 'can=250', 1],
  ['Coffee, black', 'káva, čierna káva, espresso, americano, coffee', 2, 0.1, 0, 0, 'cup=200', 1],
  ['Coffee with milk (latte)', 'biela káva, káva s mliekom, latte, caffe latte, flat white', 54, 3, 4.6, 2.8, 'cup=250', 1],
  ['Cappuccino', 'cappuccino, kapučíno', 40, 2.2, 3.3, 2, 'cup=180', 1],
  ['Tea', 'čaj, tea, chai', 1, 0, 0.2, 0, 'cup=250', 1],
  ['Masala chai (milk, sugar)', 'masala chai, chai latte, indian tea', 60, 1.8, 9, 1.8, 'cup=150', 1],
  ['Mango lassi', 'lassi, mango lassi', 100, 2.5, 16, 2.5, 'glass=250', 1],

  // ── Fast food (chains' published EU figures, rounded) ──────────────────
  ['Big Mac', 'big mac, bigmac', 234, 12.1, 19.5, 11.6, 'burger=215'],
  ['Cheeseburger (McDonald’s)', 'cheeseburger, cheeseburgery', 255, 13, 27, 10.5, 'burger=118'],
  ['McChicken', 'mcchicken, chicken burger', 245, 10, 25, 11, 'burger=170'],
  ['Chicken McNuggets', 'mcnuggets, mc nuggets, nuggets mcdonalds', 253, 15, 15, 15, 'piece=17; 6 pieces=102; 9 pieces=153'],
  ['McDonald’s fries', 'mcdonalds fries, hranolky mcdonalds, big fries', 300, 3.4, 38, 15, 'medium=114; small=80; large=150'],
];

function parseServings(s: string): Array<{ label: string; g: number }> {
  return s.split(';').map((part) => {
    const [label, g] = part.split('=');
    return { label: label.trim(), g: Number(g) };
  }).filter((x) => x.label && x.g > 0);
}

export const BASE_FOODS: BaseFood[] = ROWS.map(([name, aliases, kcal, p, c, f, servings, liquid]) => ({
  name,
  aliases: aliases.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
  kcal, protein_g: p, carbs_g: c, fat_g: f,
  servings: parseServings(servings),
  ...(liquid ? { ml: true } : {}),
}));
