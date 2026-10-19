import { PrismaClient, DataStatus } from '@prisma/client';

const prisma = new PrismaClient();

type VehicleCatalogEntry = { name: string; category: string; models: string[] };

// A practical Tunisia-oriented starter directory. Model identity and category are
// catalog data only; no generation, engine, year range, or part compatibility is inferred.
const catalog: VehicleCatalogEntry[] = [
  { name: 'Audi', category: 'Voiture particulière', models: ['80', '90', '100', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q4 e-tron', 'Q5', 'Q7', 'Q8', 'TT'] },
  { name: 'Alfa Romeo', category: 'Voiture particulière', models: ['Giulietta', 'Giulia', 'Stelvio', 'Tonale'] },
  { name: 'BYD', category: 'Voiture particulière', models: ['Dolphin', 'Atto 3', 'Seal', 'Han', 'Tang', 'Song'] },
  { name: 'BMW', category: 'Voiture particulière', models: ['Série 1', 'Série 2', 'Série 3', 'Série 4', 'Série 5', 'Série 6', 'Série 7', 'Série 8', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'Z3', 'Z4', 'i3', 'i4', 'iX'] },
  { name: 'Changan', category: 'Voiture particulière', models: ['Alsvin', 'Eado', 'CS35 Plus', 'CS55 Plus', 'CS75 Plus', 'Hunter'] },
  { name: 'Chery', category: 'Voiture particulière', models: ['Arrizo 5', 'Arrizo 6', 'Tiggo 2', 'Tiggo 4', 'Tiggo 7', 'Tiggo 8'] },
  { name: 'Chevrolet', category: 'Voiture particulière', models: ['Aveo', 'Cruze', 'Spark', 'Trax', 'Captiva', 'Colorado'] },
  { name: 'Citroën', category: 'Voiture particulière', models: ['2 CV', 'AX', 'BX', 'Saxo', 'ZX', 'Xsara', 'Xantia', 'C1', 'C2', 'C3', 'C3 Aircross', 'C4', 'C4 Cactus', 'C4 Picasso', 'C5', 'C5 Aircross', 'C6', 'C-Elysée', 'C8', 'Nemo', 'Berlingo', 'Jumpy', 'Jumper', 'SpaceTourer'] },
  { name: 'Cupra', category: 'Voiture particulière', models: ['Ateca', 'Formentor', 'Leon', 'Born', 'Tavascan'] },
  { name: 'Dacia', category: 'Voiture particulière', models: ['Logan', 'Sandero', 'Duster', 'Lodgy', 'Dokker', 'Jogger', 'Spring'] },
  { name: 'DAF', category: 'Camion', models: ['LF', 'CF', 'XF', 'XG'] },
  { name: 'DFSK', category: 'Voiture particulière', models: ['C31', 'C32', 'C35', 'C37', 'Glory 500', 'Glory 580'] },
  { name: 'Dongfeng', category: 'Camion', models: ['Captain T', 'Captain W', 'KX', 'KC', 'K7'] },
  { name: 'DS Automobiles', category: 'Voiture particulière', models: ['DS 3', 'DS 4', 'DS 7', 'DS 9'] },
  { name: 'Fiat', category: 'Voiture particulière', models: ['Uno', 'Punto', 'Panda', 'Palio', 'Siena', 'Bravo', 'Brava', 'Marea', 'Stilo', 'Grande Punto', '500', '500L', '500X', 'Tipo', 'Linea', 'Doblo', 'Fiorino', 'Ducato', 'Scudo', 'Fullback', 'Titano'] },
  { name: 'Ford', category: 'Voiture particulière', models: ['Model T', 'Escort', 'Sierra', 'Ka', 'Fiesta', 'Fusion', 'Focus', 'C-Max', 'Mondeo', 'S-Max', 'Galaxy', 'EcoSport', 'Puma', 'Kuga', 'Edge', 'Ranger', 'Maverick', 'Transit', 'Transit Connect', 'Tourneo Connect', 'Tourneo Custom'] },
  { name: 'Fuso', category: 'Camion', models: ['Canter', 'Fighter', 'Super Great'] },
  { name: 'Geely', category: 'Voiture particulière', models: ['Emgrand', 'Coolray', 'Cityray', 'Starray', 'GX3 Pro'] },
  { name: 'Great Wall', category: 'Pick-up', models: ['Wingle 5', 'Wingle 7', 'Poer', 'Cannon'] },
  { name: 'GMC', category: 'Voiture particulière', models: ['Terrain', 'Acadia', 'Yukon', 'Canyon', 'Sierra'] },
  { name: 'Haval', category: 'Voiture particulière', models: ['Jolion', 'H6', 'H9', 'Dargo'] },
  { name: 'Higer', category: 'Bus / Autocar', models: ['KLQ 6119', 'KLQ 6128', 'KLQ 6600', 'KLQ 6109'] },
  { name: 'Hino', category: 'Camion', models: ['Dutro 300', '500 Series', '700 Series'] },
  { name: 'Hongqi', category: 'Voiture particulière', models: ['H5', 'H9', 'HS3', 'HS5', 'E-HS9'] },
  { name: 'Honda', category: 'Voiture particulière', models: ['Civic', 'Accord', 'City', 'Jazz', 'Fit', 'Insight', 'Prelude', 'CR-X', 'HR-V', 'CR-V', 'Element', 'ZR-V', 'Pilot', 'Odyssey'] },
  { name: 'Hyundai', category: 'Voiture particulière', models: ['Atos', 'Getz', 'Accent', 'i10', 'i20', 'i30', 'Elantra', 'Sonata', 'Grandeur', 'Matrix', 'ix20', 'ix35', 'Kona', 'Creta', 'Tucson', 'Santa Fe', 'Palisade', 'H-1', 'Staria', 'Porter'] },
  { name: 'Isuzu', category: 'Camion', models: ['D-Max', 'N-Series', 'F-Series', 'C-Series', 'Novo', 'Citiport'] },
  { name: 'Iveco', category: 'Camion', models: ['Daily', 'Eurocargo', 'S-Way', 'T-Way', 'Urbanway', 'Crossway'] },
  { name: 'JMC', category: 'Utilitaire léger', models: ['Vigus', 'Baodian', 'Carry', 'Conquer'] },
  { name: 'JAC', category: 'Voiture particulière', models: ['J3', 'J7', 'T8', 'T9', 'N-Series', 'Sunray'] },
  { name: 'Jeep', category: 'Voiture particulière', models: ['Renegade', 'Compass', 'Cherokee', 'Grand Cherokee', 'Wrangler'] },
  { name: 'Kia', category: 'Voiture particulière', models: ['Pride', 'Picanto', 'Rio', 'Cerato', 'Ceed', 'Optima', 'K3', 'K5', 'Stonic', 'Seltos', 'Niro', 'Sportage', 'Sorento', 'Carnival', 'Carens', 'Soul', 'K2500'] },
  { name: 'King Long', category: 'Bus / Autocar', models: ['XMQ 6127', 'XMQ 6119', 'XMQ 6900', 'XMQ 6800'] },
  { name: 'KGM', category: 'Voiture particulière', models: ['Tivoli', 'Korando', 'Rexton', 'Torres', 'Musso'] },
  { name: 'Lexus', category: 'Voiture particulière', models: ['IS', 'ES', 'LS', 'UX', 'NX', 'RX', 'GX', 'LX'] },
  { name: 'Land Rover', category: 'Voiture particulière', models: ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover Evoque', 'Range Rover Sport', 'Range Rover'] },
  { name: 'Mahindra', category: 'Voiture particulière', models: ['Pik Up', 'Bolero', 'Scorpio', 'XUV300', 'XUV700'] },
  { name: 'MAN', category: 'Camion', models: ['TGL', 'TGM', 'TGS', 'TGX', 'Lion’s City', 'Lion’s Coach'] },
  { name: 'Mazda', category: 'Voiture particulière', models: ['121', '323', '626', 'Demio', 'Mazda2', 'Mazda3', 'Mazda5', 'Mazda6', 'CX-3', 'CX-30', 'CX-5', 'CX-7', 'CX-9', 'MX-5', 'BT-50'] },
  { name: 'Mercedes-Benz', category: 'Voiture particulière', models: ['Classe A', 'Classe B', 'Classe C', 'Classe E', 'GLA', 'GLC', 'GLE', 'Vito', 'Sprinter', 'Actros', 'Atego', 'Citaro', 'Tourismo'] },
  { name: 'MG', category: 'Voiture particulière', models: ['MG 3', 'MG 5', 'ZS', 'HS', 'RX5', 'Marvel R'] },
  { name: 'MINI', category: 'Voiture particulière', models: ['Cooper', 'Clubman', 'Countryman', 'Aceman'] },
  { name: 'Maserati', category: 'Voiture particulière', models: ['Ghibli', 'Quattroporte', 'Grecale', 'Levante', 'GranTurismo'] },
  { name: 'Mitsubishi', category: 'Voiture particulière', models: ['Mirage', 'ASX', 'Outlander', 'L200', 'Canter', 'Pajero'] },
  { name: 'Nissan', category: 'Voiture particulière', models: ['Sunny', 'Almera', 'Primera', 'Maxima', 'Micra', 'March', 'Note', 'Tiida', 'Juke', 'Qashqai', 'X-Trail', 'Murano', 'Pathfinder', 'Patrol', 'Terrano', 'Navara', 'NP300', 'Frontier', 'NV200', 'NV300', 'Urvan'] },
  { name: 'Porsche', category: 'Voiture particulière', models: ['718', '911', 'Panamera', 'Macan', 'Cayenne', 'Taycan'] },
  { name: 'Opel', category: 'Voiture particulière', models: ['Kadett', 'Astra', 'Vectra', 'Omega', 'Corsa', 'Tigra', 'Meriva', 'Agila', 'Zafira', 'Insignia', 'Mokka', 'Crossland', 'Grandland', 'Frontera', 'Combo', 'Vivaro', 'Movano'] },
  { name: 'Otokar', category: 'Bus / Autocar', models: ['Kent', 'Sultan', 'Navigo', 'Territo'] },
  { name: 'Peugeot', category: 'Voiture particulière', models: ['104', '106', '205', '206', '207', '208', '305', '306', '307', '308', '309', '405', '406', '407', '408', '504', '505', '605', '607', '806', '807', '1007', '2008', '3008', '4007', '4008', '5008', '508', 'Bipper', 'Rifter', 'Partner', 'Expert', 'Traveller', 'Boxer', 'Landtrek'] },
  { name: 'Renault', category: 'Voiture particulière', models: ['4', '5', '9', '11', '12', '18', '19', '21', '25', 'Clio', 'Clio Campus', 'Symbol', 'Logan', 'Mégane', 'Scénic', 'Laguna', 'Safrane', 'Fluence', 'Twingo', 'Modus', 'Koleos', 'Captur', 'Kadjar', 'Kwid', 'Arkana', 'Austral', 'Espace', 'Talisman', 'Express', 'Kangoo', 'Trafic', 'Master', 'Duster'] },
  { name: 'Renault Trucks', category: 'Camion', models: ['D', 'C', 'K', 'T', 'Master Red EDITION'] },
  { name: 'Scania', category: 'Camion', models: ['P-Series', 'G-Series', 'R-Series', 'S-Series', 'Citywide', 'Interlink'] },
  { name: 'Shacman', category: 'Camion', models: ['X3000', 'X5000', 'F3000', 'L3000'] },
  { name: 'SEAT', category: 'Voiture particulière', models: ['Ibiza', 'Leon', 'Arona', 'Ateca', 'Tarraco'] },
  { name: 'Setra', category: 'Bus / Autocar', models: ['MultiClass', 'ComfortClass', 'TopClass'] },
  { name: 'Škoda', category: 'Voiture particulière', models: ['Fabia', 'Scala', 'Octavia', 'Superb', 'Kamiq', 'Karoq', 'Kodiaq'] },
  { name: 'Suzuki', category: 'Voiture particulière', models: ['Alto', 'Celerio', 'Swift', 'Baleno', 'Vitara', 'S-Cross', 'Jimny', 'Dzire'] },
  { name: 'Subaru', category: 'Voiture particulière', models: ['Impreza', 'Legacy', 'Forester', 'Outback', 'XV / Crosstrek', 'WRX'] },
  { name: 'Tata', category: 'Voiture particulière', models: ['Xenon', 'Yodha', 'Ace', 'Ultra', 'Prima'] },
  { name: 'Temsa', category: 'Bus / Autocar', models: ['Prestij', 'Avenue', 'Maraton', 'MD9'] },
  { name: 'Tesla', category: 'Voiture particulière', models: ['Model 3', 'Model S', 'Model X', 'Model Y'] },
  { name: 'Toyota', category: 'Voiture particulière', models: ['Starlet', 'Tercel', 'Corolla', 'Camry', 'Carina', 'Avensis', 'Yaris', 'Auris', 'Prius', 'C-HR', 'RAV4', 'Highlander', '4Runner', 'Land Cruiser', 'Hilux', 'Tacoma', 'Tundra', 'Hiace', 'Proace', 'Verso'] },
  { name: 'Yutong', category: 'Bus / Autocar', models: ['ZK 6128', 'ZK 6118', 'ZK 6108', 'ZK 6858', 'ZK 6938'] },
  { name: 'Zhongtong', category: 'Bus / Autocar', models: ['LCK 6127', 'LCK 6118', 'LCK 6109', 'LCK 6898'] },
  { name: 'Volkswagen', category: 'Voiture particulière', models: ['Beetle', 'Lupo', 'Fox', 'Up!', 'Polo', 'Golf', 'Vento', 'Bora', 'Jetta', 'Passat', 'Arteon', 'Virtus', 'T-Cross', 'T-Roc', 'Tiguan', 'Touareg', 'Touran', 'Sharan', 'Caddy', 'Transporter', 'Multivan', 'Crafter', 'Amarok', 'ID.3', 'ID.4', 'ID.5', 'ID.7'] },
  { name: 'Volvo', category: 'Voiture particulière', models: ['S60', 'S90', 'XC40', 'XC60', 'XC90', 'FL', 'FE', 'FM', 'FH', '7900', '9700'] },
  { name: 'Acura', category: 'Voiture particulière', models: ['ILX', 'TLX', 'RLX', 'ADX', 'RDX', 'MDX', 'NSX'] },
  { name: 'Aston Martin', category: 'Voiture particulière', models: ['Vantage', 'DB11', 'DB12', 'DBX', 'Vanquish'] },
  { name: 'Ashok Leyland', category: 'Camion', models: ['Dost', 'Partner', 'Boss', 'Ecomet', 'AVTR', 'Viking'] },
  { name: 'BAIC', category: 'Voiture particulière', models: ['X25', 'X35', 'X55', 'X7', 'BJ40', 'EU5'] },
  { name: 'Bentley', category: 'Voiture particulière', models: ['Continental GT', 'Flying Spur', 'Bentayga'] },
  { name: 'BharatBenz', category: 'Camion', models: ['1017', '1217', '1617', '2523', '3123', '4023'] },
  { name: 'BMC', category: 'Camion', models: ['235-16', 'Tugra', 'Procity', 'Neocity', 'Belde'] },
  { name: 'Cadillac', category: 'Voiture particulière', models: ['CT4', 'CT5', 'XT4', 'XT5', 'XT6', 'Escalade', 'Lyriq'] },
  { name: 'Daihatsu', category: 'Voiture particulière', models: ['Cuore', 'Sirion', 'Terios', 'Materia', 'Move', 'Hijet', 'Gran Max'] },
  { name: 'Dodge', category: 'Voiture particulière', models: ['Dart', 'Charger', 'Challenger', 'Durango', 'Journey', 'RAM 1500'] },
  { name: 'Ferrari', category: 'Voiture particulière', models: ['Roma', 'Portofino', '296 GTB', 'F8 Tributo', 'SF90', 'Purosangue'] },
  { name: 'FAW', category: 'Camion', models: ['Tiger V', 'J6P', 'J7', 'Bestune T77', 'Bestune B70'] },
  { name: 'Foton', category: 'Camion', models: ['Aumark', 'Auman', 'Tunland', 'View', 'Toano'] },
  { name: 'Genesis', category: 'Voiture particulière', models: ['G70', 'G80', 'G90', 'GV60', 'GV70', 'GV80'] },
  { name: 'Infiniti', category: 'Voiture particulière', models: ['Q30', 'Q50', 'QX30', 'QX50', 'QX60', 'QX80'] },
  { name: 'Irizar', category: 'Bus / Autocar', models: ['i2e', 'i3', 'i4', 'i6', 'i8', 'Century'] },
  { name: 'Jaguar', category: 'Voiture particulière', models: ['XE', 'XF', 'XJ', 'E-Pace', 'F-Pace', 'F-Type', 'I-Pace'] },
  { name: 'Jetour', category: 'Voiture particulière', models: ['X70', 'X70 Plus', 'X90 Plus', 'Dashing', 'T2'] },
  { name: 'Kamaz', category: 'Camion', models: ['43118', '65115', '6520', '5490', 'K5'] },
  { name: 'Karsan', category: 'Bus / Autocar', models: ['Jest', 'Atak', 'Star', 'e-Jest', 'e-ATA'] },
  { name: 'Leapmotor', category: 'Voiture particulière', models: ['T03', 'C10', 'C11', 'C16', 'B10'] },
  { name: 'Lada', category: 'Voiture particulière', models: ['Granta', 'Vesta', 'Niva Legend', 'Niva Travel', 'Largus', 'XRAY'] },
  { name: 'Lamborghini', category: 'Voiture particulière', models: ['Huracán', 'Urus', 'Revuelto', 'Aventador', 'Gallardo'] },
  { name: 'Lancia', category: 'Voiture particulière', models: ['Ypsilon', 'Delta', 'Thema', 'Musa', 'Lybra'] },
  { name: 'Lotus', category: 'Voiture particulière', models: ['Elise', 'Exige', 'Evora', 'Emira', 'Eletre'] },
  { name: 'Lucid', category: 'Voiture particulière', models: ['Air', 'Gravity'] },
  { name: 'Lynk & Co', category: 'Voiture particulière', models: ['01', '02', '03', '05', '06', '09'] },
  { name: 'MAZ', category: 'Camion', models: ['4371', '5340', '6312', '6501', '5440'] },
  { name: 'McLaren', category: 'Voiture particulière', models: ['570S', '600LT', '720S', 'Artura', 'GT', '765LT'] },
  { name: 'MCV', category: 'Bus / Autocar', models: ['C107', 'C120', 'C127', 'DD103', 'DD104'] },
  { name: 'NIO', category: 'Voiture particulière', models: ['ET5', 'ET7', 'EL6', 'EL7', 'EL8', 'ES8'] },
  { name: 'Omoda', category: 'Voiture particulière', models: ['C5', 'C7', 'E5'] },
  { name: 'Polestar', category: 'Voiture particulière', models: ['Polestar 2', 'Polestar 3', 'Polestar 4', 'Polestar 5'] },
  { name: 'RAM', category: 'Pick-up', models: ['1500', '2500', '3500', 'ProMaster', 'Rampage'] },
  { name: 'Rolls-Royce', category: 'Voiture particulière', models: ['Ghost', 'Phantom', 'Wraith', 'Dawn', 'Cullinan', 'Spectre'] },
  { name: 'Saab', category: 'Voiture particulière', models: ['9-3', '9-5', '900', '9000'] },
  { name: 'Seres', category: 'Voiture particulière', models: ['3', '5', '7', 'Aito M5', 'Aito M7'] },
  { name: 'Smart', category: 'Voiture particulière', models: ['Fortwo', 'Forfour', '#1', '#3', '#5'] },
  { name: 'Sinotruk', category: 'Camion', models: ['Howo', 'Sitrak C7H', 'Sitrak G7S', 'Hohan'] },
  { name: 'Solaris', category: 'Bus / Autocar', models: ['Urbino 10', 'Urbino 12', 'Urbino 18', 'Urbino 24', 'Vacanza'] },
  { name: 'Tatra', category: 'Camion', models: ['Phoenix', 'Force', 'T815', 'T148'] },
  { name: 'UD Trucks', category: 'Camion', models: ['Croner', 'Quester', 'Kuzer', 'Condor'] },
  { name: 'Van Hool', category: 'Bus / Autocar', models: ['A Series', 'T Series', 'EX Series', 'TX Series'] },
  { name: 'VDL', category: 'Bus / Autocar', models: ['Citea', 'Futura', 'MidCity'] },
  { name: 'VinFast', category: 'Voiture particulière', models: ['VF 3', 'VF 5', 'VF 6', 'VF 7', 'VF 8', 'VF 9'] },
  { name: 'Xpeng', category: 'Voiture particulière', models: ['G3', 'G6', 'G9', 'P5', 'P7', 'X9'] },
  { name: 'Yuchai', category: 'Bus / Autocar', models: ['E10', 'E12', 'G12', 'C11'] },
  { name: 'Zeekr', category: 'Voiture particulière', models: ['001', '007', '009', 'X', '7X'] },
];

const slugify = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const source = 'Répertoire automobile tunisien et catalogues constructeurs; noms de modèles à confirmer selon version locale';
const sourceReference = 'https://www.automobile.tn/fr/neuf';
const trucks = new Set(['N-Series', 'F-Series', 'C-Series', 'Eurocargo', 'S-Way', 'T-Way', 'TGL', 'TGM', 'TGS', 'TGX', 'P-Series', 'G-Series', 'R-Series', 'S-Series', 'Canter', 'Fighter', 'Super Great', 'Dutro 300', '500 Series', '700 Series', 'LF', 'CF', 'XF', 'XG', 'Actros', 'Atego', 'FL', 'FE', 'FM', 'FH', 'D', 'C', 'K', 'T', 'Ultra', 'Prima']);
const buses = new Set(['Novo', 'Citiport', 'Urbanway', 'Crossway', 'Lion’s City', 'Lion’s Coach', 'Citywide', 'Interlink', 'Citaro', 'Tourismo', '7900', '9700', 'Kent', 'Sultan', 'Navigo', 'Territo', 'Prestij', 'Avenue', 'Maraton', 'MD9', 'MultiClass', 'ComfortClass', 'TopClass', 'Viking', 'Procity', 'Neocity', 'Belde', 'C107', 'C120', 'C127', 'DD103', 'DD104', 'i2e', 'i3', 'i4', 'i6', 'i8', 'Century', 'Jest', 'Atak', 'Star', 'e-Jest', 'e-ATA', 'Urbino 10', 'Urbino 12', 'Urbino 18', 'Urbino 24', 'Vacanza', 'A Series', 'T Series', 'EX Series', 'TX Series', 'Citea', 'Futura', 'MidCity', 'E10', 'E12', 'G12', 'C11']);
const pickups = new Set(['D-Max', 'Hilux', 'Landtrek', 'Amarok', 'Ranger', 'Navara', 'L200', 'BT-50', 'Colorado', 'Fullback', 'Titano', 'Musso', 'T8', 'T9', 'Pik Up', 'Xenon', 'Yodha', 'RAM 1500', 'Tunland', 'Dodge RAM 1500']);
const utilities = new Set(['Partner', 'Expert', 'Boxer', 'Berlingo', 'Jumpy', 'Jumper', 'Doblo', 'Fiorino', 'Ducato', 'Transit', 'Transit Connect', 'Tourneo Connect', 'Tourneo Custom', 'H-1', 'Staria', 'Porter', 'K2500', 'NV200', 'NV300', 'Urvan', 'Combo', 'Vivaro', 'Movano', 'Express', 'Kangoo', 'Trafic', 'Master', 'Caddy', 'Transporter', 'Multivan', 'Crafter', 'Proace', 'Hiace', 'Daily', 'Sunray', 'C31', 'C32', 'C35', 'C37', 'Ace', 'Bolero', 'Scorpio', 'View', 'Toano']);
const modelCategory = (name: string, fallback: string) => buses.has(name) ? 'Bus / Autocar' : trucks.has(name) ? 'Camion' : pickups.has(name) ? 'Pick-up' : utilities.has(name) ? 'Utilitaire léger' : fallback;

async function main() {
  for (const entry of catalog) {
    const make = await prisma.vehicleMake.upsert({
      where: { slug: slugify(entry.name) },
      update: { name: entry.name, status: DataStatus.VERIFIED, source, sourceReference },
      create: { name: entry.name, slug: slugify(entry.name), status: DataStatus.VERIFIED, source, sourceReference },
    });
    for (const modelName of entry.models) {
      await prisma.vehicleModel.upsert({
        where: { makeId_slug: { makeId: make.id, slug: slugify(modelName) } },
        update: { name: modelName, category: modelCategory(modelName, entry.category), status: DataStatus.VERIFIED, source, sourceReference },
        create: { makeId: make.id, name: modelName, slug: slugify(modelName), category: modelCategory(modelName, entry.category), status: DataStatus.VERIFIED, source, sourceReference },
      });
    }
  }
  console.info(`Catalogue de départ : ${catalog.length} marques, ${catalog.reduce((sum, entry) => sum + entry.models.length, 0)} modèles.`);
}

main().finally(() => prisma.$disconnect());
