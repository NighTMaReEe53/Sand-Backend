/**
 * Seed: Adhkar & Duas (أذكار وأدعية)
 * Idempotent — upserts every item by its stable `code`.
 * Run: npm run prisma:seed:adhkar
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AdhkarSeed {
  code: string;
  category: 'MORNING' | 'EVENING';
  arabicText: string;
  repeatCount: number;
  source: string;
}

interface DuaSeed {
  code: string;
  subCategory: 'EXAM' | 'STUDY' | 'GENERAL' | 'RELIEF' | 'POST_EXAM' | 'POST_LECTURE';
  arabicText: string;
  source: string;
  translationNote?: string;
}

// ===== أذكار الصباح (Morning Adhkar) =====
const morningAdhkar: Omit<AdhkarSeed, 'category'>[] = [
  {
    code: 'morning-001',
    arabicText:
      'آيَةُ الْكُرْسِيِّ: اللَّهُ لَا إِلَهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ، لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ، لَهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ، مَنْ ذَا الَّذِي يَشْفَعُ عِنْدَهُ إِلَّا بِإِذْنِهِ، يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ، وَلَا يُحِيطُونَ بِشَيْءٍ مِنْ عِلْمِهِ إِلَّا بِمَا شَاءَ، وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ، وَلَا يَئُودُهُ حِفْظُهُمَا، وَهُوَ الْعَلِيُّ الْعَظِيمُ',
    repeatCount: 1,
    source: 'سورة البقرة',
  },
  {
    code: 'morning-002',
    arabicText:
      'سورة الإخلاص: قُلْ هُوَ اللَّهُ أَحَدٌ، اللَّهُ الصَّمَدُ، لَمْ يَلِدْ وَلَمْ يُولَدْ، وَلَمْ يَكُنْ لَهُ كُفُوًا أَحَدٌ',
    repeatCount: 3,
    source: 'القرآن الكريم',
  },
  {
    code: 'morning-003',
    arabicText:
      'سورة الفلق: قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ، مِنْ شَرِّ مَا خَلَقَ، وَمِنْ شَرِّ غَاسِقٍ إِذَا وَقَبَ، وَمِنْ شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ، وَمِنْ شَرِّ حَاسِدٍ إِذَا حَسَدَ',
    repeatCount: 3,
    source: 'القرآن الكريم',
  },
  {
    code: 'morning-004',
    arabicText:
      'سورة الناس: قُلْ أَعُوذُ بِرَبِّ النَّاسِ، مَلِكِ النَّاسِ، إِلَهِ النَّاسِ، مِنْ شَرِّ الْوَسْوَاسِ الْخَنَّاسِ، الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ، مِنَ الْجِنَّةِ وَالنَّاسِ',
    repeatCount: 3,
    source: 'القرآن الكريم',
  },
  {
    code: 'morning-005',
    arabicText:
      'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ، رَبِّ أَسْأَلُكَ خَيْرَ مَا فِي هَذَا الْيَوْمِ وَخَيْرَ مَا بَعْدَهُ، وَأَعُوذُ بِكَ مِنْ شَرِّ مَا فِي هَذَا الْيَوْمِ وَشَرِّ مَا بَعْدَهُ',
    repeatCount: 1,
    source: 'رواه مسلم',
  },
  {
    code: 'morning-006',
    arabicText:
      'اللَّهُمَّ بِكَ أَصْبَحْنَا، وَبِكَ أَمْسَيْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ النُّشُورُ',
    repeatCount: 1,
    source: 'رواه الترمذي',
  },
  {
    code: 'morning-007',
    arabicText:
      'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي فَاغْفِرْ لِي، فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ (سيد الاستغفار)',
    repeatCount: 1,
    source: 'رواه البخاري',
  },
  {
    code: 'morning-008',
    arabicText:
      'اللَّهُمَّ عَافِنِي فِي بَدَنِي، اللَّهُمَّ عَافِنِي فِي سَمْعِي، اللَّهُمَّ عَافِنِي فِي بَصَرِي، لَا إِلَهَ إِلَّا أَنْتَ',
    repeatCount: 3,
    source: 'رواه أبو داود',
  },
  {
    code: 'morning-009',
    arabicText:
      'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْكُفْرِ وَالْفَقْرِ، وَأَعُوذُ بِكَ مِنْ عَذَابِ الْقَبْرِ، لَا إِلَهَ إِلَّا أَنْتَ',
    repeatCount: 3,
    source: 'رواه أبو داود',
  },
  {
    code: 'morning-010',
    arabicText: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ',
    repeatCount: 1,
    source: 'رواه ابن ماجه',
  },
  {
    code: 'morning-011',
    arabicText:
      'حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ',
    repeatCount: 7,
    source: 'رواه أبو داود',
  },
  {
    code: 'morning-012',
    arabicText:
      'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ',
    repeatCount: 3,
    source: 'رواه أبو داود والترمذي',
  },
  {
    code: 'morning-013',
    arabicText:
      'رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ نَبِيًّا',
    repeatCount: 3,
    source: 'رواه أحمد',
  },
  {
    code: 'morning-014',
    arabicText:
      'يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ، أَصْلِحْ لِي شَأْنِي كُلَّهُ، وَلَا تَكِلْنِي إِلَى نَفْسِي طَرْفَةَ عَيْنٍ',
    repeatCount: 1,
    source: 'رواه الحاكم والنسائي',
  },
  {
    code: 'morning-015',
    arabicText: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ',
    repeatCount: 100,
    source: 'رواه مسلم',
  },
  {
    code: 'morning-016',
    arabicText:
      'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ',
    repeatCount: 10,
    source: 'رواه أبو داود والترمذي',
  },
  {
    code: 'morning-017',
    arabicText: 'أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ',
    repeatCount: 100,
    source: 'رواه البخاري ومسلم',
  },
  {
    code: 'morning-018',
    arabicText: 'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ',
    repeatCount: 3,
    source: 'رواه مسلم',
  },
  {
    code: 'morning-019',
    arabicText: 'اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ',
    repeatCount: 10,
    source: 'عمل متوارث',
  },
];

// ===== أذكار المساء (Evening Adhkar) =====
const eveningAdhkar: Omit<AdhkarSeed, 'category'>[] = [
  {
    code: 'evening-001',
    arabicText:
      'آيَةُ الْكُرْسِيِّ: اللَّهُ لَا إِلَهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ، لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ، لَهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ، مَنْ ذَا الَّذِي يَشْفَعُ عِنْدَهُ إِلَّا بِإِذْنِهِ، يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ، وَلَا يُحِيطُونَ بِشَيْءٍ مِنْ عِلْمِهِ إِلَّا بِمَا شَاءَ، وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ، وَلَا يَئُودُهُ حِفْظُهُمَا، وَهُوَ الْعَلِيُّ الْعَظِيمُ',
    repeatCount: 1,
    source: 'سورة البقرة',
  },
  {
    code: 'evening-002',
    arabicText:
      'سورة الإخلاص: قُلْ هُوَ اللَّهُ أَحَدٌ، اللَّهُ الصَّمَدُ، لَمْ يَلِدْ وَلَمْ يُولَدْ، وَلَمْ يَكُنْ لَهُ كُفُوًا أَحَدٌ',
    repeatCount: 3,
    source: 'القرآن الكريم',
  },
  {
    code: 'evening-003',
    arabicText:
      'سورة الفلق: قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ، مِنْ شَرِّ مَا خَلَقَ، وَمِنْ شَرِّ غَاسِقٍ إِذَا وَقَبَ، وَمِنْ شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ، وَمِنْ شَرِّ حَاسِدٍ إِذَا حَسَدَ',
    repeatCount: 3,
    source: 'القرآن الكريم',
  },
  {
    code: 'evening-004',
    arabicText:
      'سورة الناس: قُلْ أَعُوذُ بِرَبِّ النَّاسِ، مَلِكِ النَّاسِ، إِلَهِ النَّاسِ، مِنْ شَرِّ الْوَسْوَاسِ الْخَنَّاسِ، الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ، مِنَ الْجِنَّةِ وَالنَّاسِ',
    repeatCount: 3,
    source: 'القرآن الكريم',
  },
  {
    code: 'evening-005',
    arabicText:
      'أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ، رَبِّ أَسْأَلُكَ خَيْرَ مَا فِي هَذِهِ اللَّيْلَةِ وَخَيْرَ مَا بَعْدَهَا، وَأَعُوذُ بِكَ مِنْ شَرِّ مَا فِي هَذِهِ اللَّيْلَةِ وَشَرِّ مَا بَعْدَهَا',
    repeatCount: 1,
    source: 'رواه مسلم',
  },
  {
    code: 'evening-006',
    arabicText:
      'اللَّهُمَّ بِكَ أَمْسَيْنَا، وَبِكَ أَصْبَحْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ الْمَصِيرُ',
    repeatCount: 1,
    source: 'رواه الترمذي',
  },
  {
    code: 'evening-007',
    arabicText:
      'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي فَاغْفِرْ لِي، فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ',
    repeatCount: 1,
    source: 'رواه البخاري',
  },
  {
    code: 'evening-008',
    arabicText:
      'اللَّهُمَّ عَافِنِي فِي بَدَنِي، اللَّهُمَّ عَافِنِي فِي سَمْعِي، اللَّهُمَّ عَافِنِي فِي بَصَرِي، لَا إِلَهَ إِلَّا أَنْتَ',
    repeatCount: 3,
    source: 'رواه أبو داود',
  },
  {
    code: 'evening-009',
    arabicText:
      'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْكُفْرِ وَالْفَقْرِ، وَأَعُوذُ بِكَ مِنْ عَذَابِ الْقَبْرِ، لَا إِلَهَ إِلَّا أَنْتَ',
    repeatCount: 3,
    source: 'رواه أبو داود',
  },
  {
    code: 'evening-010',
    arabicText:
      'حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ',
    repeatCount: 7,
    source: 'رواه أبو داود',
  },
  {
    code: 'evening-011',
    arabicText:
      'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ',
    repeatCount: 3,
    source: 'رواه أبو داود والترمذي',
  },
  {
    code: 'evening-012',
    arabicText:
      'رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ نَبِيًّا',
    repeatCount: 3,
    source: 'رواه أحمد',
  },
  {
    code: 'evening-013',
    arabicText:
      'يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ، أَصْلِحْ لِي شَأْنِي كُلَّهُ، وَلَا تَكِلْنِي إِلَى نَفْسِي طَرْفَةَ عَيْنٍ',
    repeatCount: 1,
    source: 'رواه الحاكم والنسائي',
  },
  {
    code: 'evening-014',
    arabicText:
      'اللَّهُمَّ إِنِّي أَمْسَيْتُ أُشْهِدُكَ، وَأُشْهِدُ حَمَلَةَ عَرْشِكَ، وَمَلَائِكَتَكَ، وَجَمِيعَ خَلْقِكَ، أَنَّكَ أَنْتَ اللَّهُ لَا إِلَهَ إِلَّا أَنْتَ وَحْدَكَ لَا شَرِيكَ لَكَ، وَأَنَّ مُحَمَّدًا عَبْدُكَ وَرَسُولُكَ',
    repeatCount: 4,
    source: 'رواه أبو داود',
  },
  {
    code: 'evening-015',
    arabicText: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ',
    repeatCount: 100,
    source: 'رواه مسلم',
  },
  {
    code: 'evening-016',
    arabicText:
      'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ',
    repeatCount: 10,
    source: 'رواه أبو داود والترمذي',
  },
  {
    code: 'evening-017',
    arabicText: 'أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ',
    repeatCount: 100,
    source: 'رواه البخاري ومسلم',
  },
  {
    code: 'evening-018',
    arabicText: 'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ',
    repeatCount: 3,
    source: 'رواه مسلم',
  },
  {
    code: 'evening-019',
    arabicText: 'اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ',
    repeatCount: 10,
    source: 'عمل متوارث',
  },
];

// ===== أدعية الطلاب والامتحانات (always visible, no counter) =====
const studentDuas: DuaSeed[] = [
  {
    code: 'dua-exam-001',
    subCategory: 'EXAM',
    arabicText:
      'رَبِّ اشْرَحْ لِي صَدْرِي، وَيَسِّرْ لِي أَمْرِي، وَاحْلُلْ عُقْدَةً مِنْ لِسَانِي، يَفْقَهُوا قَوْلِي',
    source: 'سورة طه',
  },
  {
    code: 'dua-study-001',
    subCategory: 'STUDY',
    arabicText: 'رَبِّ زِدْنِي عِلْمًا',
    source: 'سورة طه',
  },
  {
    code: 'dua-exam-002',
    subCategory: 'EXAM',
    arabicText:
      'اللَّهُمَّ لَا سَهْلَ إِلَّا مَا جَعَلْتَهُ سَهْلًا، وَأَنْتَ تَجْعَلُ الْحَزْنَ إِذَا شِئْتَ سَهْلًا',
    source: 'رواه ابن حبان',
  },
  {
    code: 'dua-study-002',
    subCategory: 'STUDY',
    arabicText:
      'اللَّهُمَّ إِنِّي أَسْأَلُكَ فَهْمَ النَّبِيِّينَ، وَحِفْظَ الْمُرْسَلِينَ وَالْمَلَائِكَةِ الْمُقَرَّبِينَ',
    source: 'دعاء مأثور',
  },
  {
    code: 'dua-general-001',
    subCategory: 'GENERAL',
    arabicText: 'حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ',
    source: 'سورة آل عمران',
  },
  {
    code: 'dua-study-003',
    subCategory: 'STUDY',
    arabicText: 'رَبِّ إِنِّي لِمَا أَنْزَلْتَ إِلَيَّ مِنْ خَيْرٍ فَقِيرٌ',
    source: 'سورة القصص',
  },
  {
    code: 'dua-general-002',
    subCategory: 'GENERAL',
    arabicText:
      'اللَّهُمَّ اجْعَلْ خَيْرَ عُمْرِي آخِرَهُ، وَخَيْرَ عَمَلِي خَوَاتِمَهُ، وَخَيْرَ أَيَّامِي يَوْمَ أَلْقَاكَ فِيهِ',
    source: 'رواه ابن حبان',
  },
  {
    code: 'dua-study-004',
    subCategory: 'STUDY',
    arabicText:
      'اللَّهُمَّ نَوِّرْ قَلْبِي بِنُورِ هِدَايَتِكَ، وَاشْرَحْ صَدْرِي بِفَهْمِ كِتَابِكَ',
    source: 'دعاء مأثور',
  },
  {
    code: 'dua-general-003',
    subCategory: 'GENERAL',
    arabicText:
      'رَبِّ اجْعَلْنِي مُقِيمَ الصَّلَاةِ وَمِنْ ذُرِّيَّتِي، رَبَّنَا وَتَقَبَّلْ دُعَاءِ',
    source: 'سورة إبراهيم',
  },
  {
    code: 'dua-general-004',
    subCategory: 'GENERAL',
    arabicText: 'اللَّهُمَّ أَعِنِّي عَلَى ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ',
    source: 'رواه أبو داود والنسائي',
  },
  {
    code: 'dua-general-005',
    subCategory: 'GENERAL',
    arabicText: 'يَا مُقَلِّبَ الْقُلُوبِ ثَبِّتْ قَلْبِي عَلَى دِينِكَ',
    source: 'رواه الترمذي',
  },
  {
    code: 'dua-general-006',
    subCategory: 'GENERAL',
    arabicText:
      'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ',
    source: 'سورة البقرة',
  },
];

// ===== بعد الامتحان / الكويز / المحاضرة (post-activity auto-trigger pool) =====
const postActivityDuas: DuaSeed[] = [
  {
    code: 'dua-post-001',
    subCategory: 'POST_EXAM',
    arabicText: 'الْحَمْدُ لِلَّهِ الَّذِي بِنِعْمَتِهِ تَتِمُّ الصَّالِحَاتُ',
    source: 'رواه ابن ماجه',
  },
  {
    code: 'dua-post-002',
    subCategory: 'POST_LECTURE',
    arabicText:
      'سُبْحَانَكَ اللَّهُمَّ وَبِحَمْدِكَ، أَشْهَدُ أَنْ لَا إِلَهَ إِلَّا أَنْتَ، أَسْتَغْفِرُكَ وَأَتُوبُ إِلَيْكَ',
    translationNote: 'كفارة المجلس',
    source: 'رواه الترمذي وأبو داود',
  },
  {
    code: 'dua-post-003',
    subCategory: 'POST_EXAM',
    arabicText:
      'اللَّهُمَّ لَا مَانِعَ لِمَا أَعْطَيْتَ، وَلَا مُعْطِيَ لِمَا مَنَعْتَ، وَلَا يَنْفَعُ ذَا الْجَدِّ مِنْكَ الْجَدُّ',
    source: 'رواه البخاري ومسلم',
  },
  {
    code: 'dua-post-004',
    subCategory: 'RELIEF',
    arabicText:
      'الْحَمْدُ لِلَّهِ الَّذِي هَدَانَا لِهَذَا وَمَا كُنَّا لِنَهْتَدِيَ لَوْلَا أَنْ هَدَانَا اللَّهُ',
    source: 'سورة الأعراف',
  },
  {
    code: 'dua-post-005',
    subCategory: 'RELIEF',
    arabicText: 'رَبِّ أَوْزِعْنِي أَنْ أَشْكُرَ نِعْمَتَكَ الَّتِي أَنْعَمْتَ عَلَيَّ',
    source: 'سورة النمل',
  },
  {
    code: 'dua-post-006',
    subCategory: 'STUDY',
    arabicText:
      'اللَّهُمَّ إِنِّي أَسْتَوْدِعُكَ مَا عَلِمْتُ، وَأَسْتَرْجِعُهُ عِنْدَ حَاجَتِي إِلَيْهِ',
    translationNote: 'يُستحب بعد طلب العلم',
    source: 'دعاء مأثور',
  },
  {
    code: 'dua-post-007',
    subCategory: 'RELIEF',
    arabicText:
      'حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ',
    source: 'رواه أبو داود',
  },
];

async function main() {
  console.log('🌱 Seeding Adhkar & Duas...');

  for (const [index, item] of morningAdhkar.entries()) {
    await prisma.adhkarItem.upsert({
      where: { code: item.code },
      update: {
        category: 'MORNING',
        arabicText: item.arabicText,
        repeatCount: item.repeatCount,
        source: item.source,
        sortOrder: index + 1,
        isDeleted: false,
      },
      create: {
        code: item.code,
        category: 'MORNING',
        arabicText: item.arabicText,
        repeatCount: item.repeatCount,
        source: item.source,
        sortOrder: index + 1,
      },
    });
  }
  console.log(`   ✅ ${morningAdhkar.length} أذكار الصباح`);

  for (const [index, item] of eveningAdhkar.entries()) {
    await prisma.adhkarItem.upsert({
      where: { code: item.code },
      update: {
        category: 'EVENING',
        arabicText: item.arabicText,
        repeatCount: item.repeatCount,
        source: item.source,
        sortOrder: index + 1,
        isDeleted: false,
      },
      create: {
        code: item.code,
        category: 'EVENING',
        arabicText: item.arabicText,
        repeatCount: item.repeatCount,
        source: item.source,
        sortOrder: index + 1,
      },
    });
  }
  console.log(`   ✅ ${eveningAdhkar.length} أذكار المساء`);

  const allDuas = [...studentDuas, ...postActivityDuas];
  for (const [index, dua] of allDuas.entries()) {
    await prisma.duaItem.upsert({
      where: { code: dua.code },
      update: {
        subCategory: dua.subCategory,
        arabicText: dua.arabicText,
        source: dua.source,
        translationNote: dua.translationNote ?? null,
        sortOrder: index + 1,
        isDeleted: false,
      },
      create: {
        code: dua.code,
        subCategory: dua.subCategory,
        arabicText: dua.arabicText,
        source: dua.source,
        translationNote: dua.translationNote ?? null,
        sortOrder: index + 1,
      },
    });
  }
  console.log(`   ✅ ${allDuas.length} دعاء`);
  console.log('🌿 Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
