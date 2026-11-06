/*
 * Troca de idioma do site (cliente) -- Esfiha da Casa.
 *
 * Como funciona: o site continua escrito em portugues (e o texto de origem).
 * Este ficheiro poe um seletor de idioma no cabecalho e, quando o cliente
 * escolhe outra lingua, troca cada texto visivel pela traducao que esta no
 * dicionario D abaixo (ou por um dos padroes P, para frases com numeros e
 * precos). Um MutationObserver repete isto sempre que o site mostra texto
 * novo (carrinho, avisos, erros), sem mexer na logica do pedido.
 *
 * O que NAO e traduzido, de proposito:
 *  - a mensagem que segue para o WhatsApp da loja (fica sempre em PT, e a
 *    equipa que a le);
 *  - nomes dos sabores, combos e marcas de bebidas (sao nomes proprios);
 *  - o que o cliente escreve nos campos.
 *
 * Texto novo no site que nao esteja no dicionario aparece em portugues ate
 * ser acrescentado aqui -- nada parte, so fica por traduzir.
 */
(function () {
  'use strict';

  var LANGS = [
    { id: 'pe', flag: '\u{1F1F5}\u{1F1F9}', code: 'PT', nome: 'Português (Portugal)', html: 'pt-PT' },
    { id: 'pt', flag: '\u{1F1E7}\u{1F1F7}', code: 'BR', nome: 'Português (Brasil)', html: 'pt-BR' },
    { id: 'en', flag: '\u{1F1EC}\u{1F1E7}', code: 'EN', nome: 'English', html: 'en' },
    { id: 'es', flag: '\u{1F1EA}\u{1F1F8}', code: 'ES', nome: 'Español', html: 'es' },
    { id: 'fr', flag: '\u{1F1EB}\u{1F1F7}', code: 'FR', nome: 'Français', html: 'fr' },
    { id: 'de', flag: '\u{1F1E9}\u{1F1EA}', code: 'DE', nome: 'Deutsch', html: 'de' },
  ];
  // Idiomas extra (NL, IT, PL, SV, UA) vem de /i18n-extra.js, se estiver carregado.
  var EX = window.I18N_EXTRA || { langs: [], sug: {}, D: {}, pat: null };
  LANGS = LANGS.concat(EX.langs);
  var CHAVE = 'esfiha_idioma';
  var CHAVE_SUGESTAO = 'esfiha_idioma_sugerido';
  var COL = { en: 0, es: 1, fr: 2, de: 3 };

  // Dicionario: texto em PT (sem espacos a mais) -> [en, es, fr, de].
  var D = {
    // ---- topo e apresentacao ----
    'Esfiha da Casa — Esfihas brasileiras em Portimão | Delivery e Retirada': ['Esfiha da Casa — Brazilian esfihas in Portimão | Delivery & Pick-up', 'Esfiha da Casa — Esfihas brasileñas en Portimão | Entrega y recogida', 'Esfiha da Casa — Esfihas brésiliennes à Portimão | Livraison et retrait', 'Esfiha da Casa – Brasilianische Esfihas in Portimão | Lieferung & Abholung'],
    'Seu pedido — Esfiha da Casa': ['Your order — Esfiha da Casa', 'Tu pedido — Esfiha da Casa', 'Votre commande — Esfiha da Casa', 'Deine Bestellung – Esfiha da Casa'],
    'A verificar…': ['Checking…', 'Comprobando…', 'Vérification…', 'Wird geprüft…'],
    'Aberto agora': ['Open now', 'Abierto ahora', 'Ouvert', 'Jetzt geöffnet'],
    'Fechado agora': ['Closed now', 'Cerrado ahora', 'Fermé pour le moment', 'Jetzt geschlossen'],
    'Loja fechada': ['Shop closed', 'Tienda cerrada', 'Boutique fermée', 'Laden geschlossen'],
    'Promoção de Halloween — só hoje!': ['Halloween special — today only!', 'Promoción de Halloween — ¡solo hoy!', 'Promo Halloween — aujourd’hui seulement !', 'Halloween-Aktion — nur heute!'],
    '🛵 Entrega grátis · 🍬 Brinde para as crianças 🕷️🕸️💀': ['🛵 Free delivery · 🍬 A treat for the kids 🕷️🕸️💀', '🛵 Envío gratis · 🍬 Regalo para los niños 🕷️🕸️💀', '🛵 Livraison gratuite · 🍬 Une surprise pour les enfants 🕷️🕸️💀', '🛵 Kostenlose Lieferung · 🍬 Eine Überraschung für die Kinder 🕷️🕸️💀'],
    'Tem sabor que a gente não esquece.': ['A taste you won’t forget.', 'Un sabor que no se olvida.', 'Un goût qu’on n’oublie pas.', 'Ein Geschmack, den man nicht vergisst.'],
    'Portimão · Delivery e retirada combinada · Pedidos pelo WhatsApp': ['Portimão · Delivery and arranged pick-up · Orders via WhatsApp', 'Portimão · Entrega a domicilio y recogida concertada · Pedidos por WhatsApp', 'Portimão · Livraison et retrait sur rendez-vous · Commandes par WhatsApp', 'Portimão · Lieferung und Abholung nach Absprache · Bestellung per WhatsApp'],
    'Não temos loja física — fazemos esfihas caseiras só para entrega e retirada combinada por WhatsApp.': ['We don’t have a shop — we make homemade esfihas for delivery, or pick-up arranged via WhatsApp, only.', 'No tenemos tienda física: hacemos esfihas caseras solo para entrega a domicilio y recogida concertada por WhatsApp.', 'Nous n’avons pas de boutique : nous préparons des esfihas maison uniquement en livraison ou à retirer sur rendez-vous via WhatsApp.', 'Wir haben kein Ladengeschäft – wir backen hausgemachte Esfihas nur zur Lieferung oder zur Abholung nach Absprache per WhatsApp.'],
    '🫓 Fazer o meu pedido': ['🫓 Place my order', '🫓 Hacer mi pedido', '🫓 Passer ma commande', '🫓 Jetzt bestellen'],

    // ---- cardapio ----
    'Nossos sabores': ['Our flavours', 'Nuestros sabores', 'Nos saveurs', 'Unsere Sorten'],
    'Salgadas pra quem ama o clássico, doces pra fechar com chave de ouro.': ['Savoury ones for lovers of the classics, sweet ones to finish on a high note.', 'Saladas para los amantes de lo clásico, dulces para cerrar con broche de oro.', 'Des salées pour les amateurs de classiques, des sucrées pour finir en beauté.', 'Herzhafte für Klassik-Fans, süße für den krönenden Abschluss.'],
    'Salgadas': ['Savoury', 'Saladas', 'Salées', 'Herzhaft'],
    'Doces': ['Sweet', 'Dulces', 'Sucrées', 'Süß'],
    'Carne de vaca picada, tomate, cebola e salsinha': ['Minced beef, tomato, onion and parsley', 'Carne de ternera picada, tomate, cebolla y perejil', 'Bœuf haché, tomate, oignon et persil', 'Rinderhackfleisch, Tomate, Zwiebel und Petersilie'],
    'Recheio cremoso de mussarela com salsinha': ['Creamy mozzarella filling with parsley', 'Relleno cremoso de mozzarella con perejil', 'Garniture crémeuse de mozzarella au persil', 'Cremige Mozzarella-Füllung mit Petersilie'],
    'Frango desfiado bem temperado com queijo cremoso': ['Well-seasoned shredded chicken with cream cheese', 'Pollo desmenuzado bien sazonado con queso cremoso', 'Poulet effiloché bien assaisonné et fromage crémeux', 'Gut gewürztes Zupfhähnchen mit Frischkäse'],
    'Calabresa, cebola': ['Calabresa sausage, onion', 'Longaniza calabresa, cebolla', 'Saucisse calabresa, oignon', 'Calabresa-Wurst, Zwiebel'],
    'Fiambre e queijo': ['Ham and cheese', 'Jamón y queso', 'Jambon et fromage', 'Schinken und Käse'],
    'Queijo, tomate e manjericão': ['Cheese, tomato and basil', 'Queso, tomate y albahaca', 'Fromage, tomate et basilic', 'Käse, Tomate und Basilikum'],
    'Recheio cremoso de Nutella Original': ['Creamy original Nutella filling', 'Relleno cremoso de Nutella original', 'Garniture crémeuse au Nutella original', 'Cremige Füllung mit Original-Nutella'],
    'Mussarela com goiabada': ['Mozzarella with guava paste', 'Mozzarella con dulce de guayaba', 'Mozzarella et pâte de goyave', 'Mozzarella mit Guavenpaste'],
    'Banana, leite condensado, canela': ['Banana, condensed milk, cinnamon', 'Plátano, leche condensada, canela', 'Banane, lait concentré sucré, cannelle', 'Banane, Kondensmilch, Zimt'],
    'Glúten': ['Gluten', 'Gluten', 'Gluten', 'Gluten'],
    'Sésamo': ['Sesame', 'Sésamo', 'Sésame', 'Sesam'],
    'Leite': ['Milk', 'Leche', 'Lait', 'Milch'],
    'Avelã': ['Hazelnut', 'Avellana', 'Noisette', 'Haselnuss'],
    'Soja': ['Soy', 'Soja', 'Soja', 'Soja'],
    'Novidade': ['New', 'Nuevo', 'Nouveau', 'Neu'],
    'Esgotado': ['Sold out', 'Agotado', 'Épuisé', 'Ausverkauft'],
    'Esgotado por hoje': ['Sold out today', 'Agotado por hoy', 'Épuisé pour aujourd’hui', 'Für heute ausverkauft'],
    'Combos e promoções': ['Combos & deals', 'Combos y promociones', 'Menus et promotions', 'Combos & Angebote'],
    'Combo': ['Combo', 'Combo', 'Menu', 'Combo'],
    'Promoção': ['Deal', 'Promoción', 'Promo', 'Angebot'],
    '3 esfihas salgadas à escolha + 1 bebida de lata': ['3 savoury esfihas of your choice + 1 canned drink', '3 esfihas saladas a elegir + 1 bebida en lata', '3 esfihas salées au choix + 1 boisson en canette', '3 herzhafte Esfihas nach Wahl + 1 Dosengetränk'],
    '15 salgadas + 5 doces à escolha + 2 bebidas de 1L grátis': ['15 savoury + 5 sweet of your choice + 2 free 1L drinks', '15 saladas + 5 dulces a elegir + 2 bebidas de 1 L gratis', '15 salées + 5 sucrées au choix + 2 boissons de 1 L offertes', '15 herzhafte + 5 süße nach Wahl + 2 Getränke à 1 l gratis'],
    '6 esfihas salgadas + 2 doces à escolha': ['6 savoury + 2 sweet esfihas of your choice', '6 esfihas saladas + 2 dulces a elegir', '6 esfihas salées + 2 sucrées au choix', '6 herzhafte + 2 süße Esfihas nach Wahl'],
    'Na compra de 10 esfihas de qualquer sabor, ganha 1 bebida de 1L à escolha. É automático: chegue às 10 e escolha a bebida no seu pedido. Não acumula com combos nem com outras promoções — as esfihas que vêm dentro de um combo não contam.': ['Buy 10 esfihas of any flavour and get a 1L drink of your choice. It’s automatic: reach 10 and pick the drink in your order. Can’t be combined with combos or other deals — esfihas inside a combo don’t count.', 'Por la compra de 10 esfihas de cualquier sabor, llévate 1 bebida de 1 L a elegir. Es automático: llega a 10 y elige la bebida en tu pedido. No acumulable con combos ni con otras promociones; las esfihas incluidas en un combo no cuentan.', 'Pour 10 esfihas achetées, toutes saveurs confondues, une boisson de 1 L au choix offerte. C’est automatique : atteignez 10 et choisissez la boisson dans votre commande. Non cumulable avec les menus ni avec d’autres promotions — les esfihas comprises dans un menu ne comptent pas.', 'Beim Kauf von 10 Esfihas beliebiger Sorte gibt es 1 Getränk à 1 l nach Wahl gratis. Ganz automatisch: Ab 10 Stück wählst du das Getränk in deiner Bestellung. Nicht mit Combos oder anderen Angeboten kombinierbar – Esfihas aus einem Combo zählen nicht.'],
    'Grátis': ['Free', 'Gratis', 'Offert', 'Gratis'],
    'Bebidas': ['Drinks', 'Bebidas', 'Boissons', 'Getränke'],
    'Garrafa 1 litro — dá para partilhar': ['1-litre bottle — great for sharing', 'Botella de 1 litro, para compartir', 'Bouteille d’1 litre — à partager', '1-Liter-Flasche – zum Teilen'],
    'Lata 33cl': ['33cl can', 'Lata 33 cl', 'Canette 33 cl', 'Dose 0,33 l'],
    'Garrafa 50cl': ['50cl bottle', 'Botella 50 cl', 'Bouteille 50 cl', 'Flasche 0,5 l'],
    'Água': ['Water', 'Agua', 'Eau', 'Wasser'],
    'Fanta Laranja': ['Fanta Orange', 'Fanta Naranja', 'Fanta Orange', 'Fanta Orange'],
    'Fanta Laranja 1L': ['Fanta Orange 1L', 'Fanta Naranja 1 L', 'Fanta Orange 1 L', 'Fanta Orange 1 l'],
    'Iced Tea Pêssego': ['Peach Iced Tea', 'Iced Tea Melocotón', 'Iced Tea Pêche', 'Iced Tea Pfirsich'],
    'Alérgenos': ['Allergens', 'Alérgenos', 'Allergènes', 'Allergene'],
    'Todas as esfihas levam massa de trigo, então contêm glúten. O extra queijo (leite) também é alérgeno.': ['All esfihas are made with wheat dough, so they contain gluten. The extra cheese (milk) is also an allergen.', 'Todas las esfihas llevan masa de trigo, así que contienen gluten. El extra de queso (leche) también es alérgeno.', 'Toutes les esfihas sont faites avec une pâte de blé et contiennent donc du gluten. Le supplément fromage (lait) est aussi un allergène.', 'Alle Esfihas werden mit Weizenteig gemacht und enthalten daher Gluten. Der Extra-Käse (Milch) ist ebenfalls ein Allergen.'],
    'Tudo é preparado na mesma cozinha, então pode ter traços de outros alérgenos. Se você tem alguma alergia, avisa a gente no WhatsApp antes de pedir.': ['Everything is prepared in the same kitchen, so it may contain traces of other allergens. If you have an allergy, let us know on WhatsApp before ordering.', 'Todo se prepara en la misma cocina, por lo que puede contener trazas de otros alérgenos. Si tienes alguna alergia, avísanos por WhatsApp antes de pedir.', 'Tout est préparé dans la même cuisine, des traces d’autres allergènes sont donc possibles. Si vous avez une allergie, prévenez-nous sur WhatsApp avant de commander.', 'Alles wird in derselben Küche zubereitet, daher können Spuren anderer Allergene enthalten sein. Wenn du eine Allergie hast, sag uns vor der Bestellung per WhatsApp Bescheid.'],

    // ---- extras (aparecem como "Nome +0,60€") ----
    'Azeitona': ['Olives', 'Aceitunas', 'Olives', 'Oliven'],
    'Bacon': ['Bacon', 'Bacon', 'Bacon', 'Speck'],
    'Banana e Canela': ['Banana & cinnamon', 'Plátano y canela', 'Banane et cannelle', 'Banane & Zimt'],
    'Calabresa': ['Calabresa sausage', 'Longaniza calabresa', 'Saucisse calabresa', 'Calabresa-Wurst'],
    'Carne': ['Beef', 'Carne', 'Viande', 'Fleisch'],
    'Chouriço em cubos': ['Diced chorizo', 'Chorizo en dados', 'Chorizo en dés', 'Chorizo-Würfel'],
    'Coco': ['Coconut', 'Coco', 'Noix de coco', 'Kokos'],
    'Fiambre': ['Ham', 'Jamón', 'Jambon', 'Schinken'],
    'Frango': ['Chicken', 'Pollo', 'Poulet', 'Hähnchen'],
    'Goiabada': ['Guava paste', 'Dulce de guayaba', 'Pâte de goyave', 'Guavenpaste'],
    'Manjericão': ['Basil', 'Albahaca', 'Basilic', 'Basilikum'],
    'Milho': ['Corn', 'Maíz', 'Maïs', 'Mais'],
    'Mussarela': ['Mozzarella', 'Mozzarella', 'Mozzarella', 'Mozzarella'],
    'Queijo': ['Cheese', 'Queso', 'Fromage', 'Käse'],
    'Tomate': ['Tomato', 'Tomate', 'Tomate', 'Tomate'],
    'esse sabor': ['that flavour', 'ese sabor', 'cette saveur', 'diese Sorte'],
    'esse sabor doce': ['that sweet flavour', 'ese sabor dulce', 'cette saveur sucrée', 'diese süße Sorte'],

    // ---- montar o pedido ----
    'Monte seu pedido': ['Build your order', 'Arma tu pedido', 'Composez votre commande', 'Stell deine Bestellung zusammen'],
    'Escolha as quantidades, personalize e envie direto no WhatsApp.': ['Choose the quantities, customise and send it straight to WhatsApp.', 'Elige las cantidades, personaliza y envíalo directamente por WhatsApp.', 'Choisissez les quantités, personnalisez et envoyez directement sur WhatsApp.', 'Wähle die Mengen, passe alles an und schick es direkt per WhatsApp.'],
    '🗑 Limpar pedido': ['🗑 Clear order', '🗑 Vaciar pedido', '🗑 Vider la commande', '🗑 Bestellung leeren'],
    'Tem certeza? Toque outra vez': ['Are you sure? Tap again', '¿Seguro? Toca otra vez', 'Vous êtes sûr ? Touchez à nouveau', 'Sicher? Nochmal tippen'],
    'Você ainda não escolheu nada. Use os botões + nos sabores acima.': ['You haven’t chosen anything yet. Use the + buttons on the flavours above.', 'Aún no has elegido nada. Usa los botones + de los sabores de arriba.', 'Vous n’avez encore rien choisi. Utilisez les boutons + sur les saveurs ci-dessus.', 'Du hast noch nichts ausgewählt. Nutze die +-Tasten bei den Sorten oben.'],
    'Tirar esta linha': ['Remove this item', 'Quitar esta línea', 'Retirer cette ligne', 'Diese Position entfernen'],
    'Tirar esta esfiha': ['Remove this esfiha', 'Quitar esta esfiha', 'Retirer cette esfiha', 'Diese Esfiha entfernen'],
    '🎁 Bebida de 1L grátis': ['🎁 Free 1L drink', '🎁 Bebida de 1 L gratis', '🎁 Boisson de 1 L offerte', '🎁 Gratis-Getränk 1 l'],
    '(conforme o stock existente)': ['(subject to stock)', '(según existencias)', '(selon le stock disponible)', '(je nach Vorrat)'],
    '⚠️ De momento não temos esfihas doces disponíveis (a massa esgotou por hoje). Pode escolher salgadas no lugar, sem perder o combo.': ['⚠️ We’re out of sweet esfihas right now (today’s dough has run out). You can choose savoury ones instead and keep the combo.', '⚠️ Ahora mismo no tenemos esfihas dulces (la masa se ha agotado por hoy). Puedes elegir saladas en su lugar sin perder el combo.', '⚠️ Nous n’avons plus d’esfihas sucrées pour le moment (la pâte est épuisée pour aujourd’hui). Vous pouvez choisir des salées à la place, sans perdre le menu.', '⚠️ Süße Esfihas sind gerade nicht verfügbar (der Teig ist für heute aus). Du kannst stattdessen herzhafte wählen und behältst das Combo.'],
    'Não acumula com combos nem com outras promoções.': ['Can’t be combined with combos or other deals.', 'No acumulable con combos ni con otras promociones.', 'Non cumulable avec les menus ni avec d’autres promotions.', 'Nicht mit Combos oder anderen Angeboten kombinierbar.'],
    'Como você quer receber?': ['How would you like to get it?', '¿Cómo quieres recibirlo?', 'Comment souhaitez-vous la recevoir ?', 'Wie möchtest du sie erhalten?'],
    '🛵 Entrega': ['🛵 Delivery', '🛵 Entrega a domicilio', '🛵 Livraison', '🛵 Lieferung'],
    '🧺 Retirada': ['🧺 Pick-up', '🧺 Recogida', '🧺 Retrait', '🧺 Abholung'],
    'Entrega': ['Delivery', 'Entrega a domicilio', 'Livraison', 'Lieferung'],
    'Retirada': ['Pick-up', 'Recogida', 'Retrait', 'Abholung'],
    'retirada': ['pick-up', 'recogida', 'retrait', 'Abholung'],
    'Taxa de entrega: calculada pela sua morada': ['Delivery fee: calculated from your address', 'Gastos de envío: según tu dirección', 'Frais de livraison : calculés selon votre adresse', 'Liefergebühr: wird anhand deiner Adresse berechnet'],
    '🎃 Hoje a entrega é': ['🎃 Today delivery is', '🎃 Hoy el envío es', '🎃 Aujourd’hui, la livraison est', '🎃 Heute ist die Lieferung'],
    'grátis': ['free', 'gratis', 'gratuite', 'gratis'],
    '(promoção de Halloween)!': ['(Halloween special)!', '(promoción de Halloween)!', '(promo Halloween) !', '(Halloween-Aktion)!'],
    '(promoção de Halloween)': ['(Halloween special)', '(promoción de Halloween)', '(promo Halloween)', '(Halloween-Aktion)'],
    'Rua e número': ['Street and number', 'Calle y número', 'Rue et numéro', 'Straße und Hausnummer'],
    'Andar (opcional)': ['Floor / flat (optional)', 'Piso (opcional)', 'Étage (facultatif)', 'Stockwerk (optional)'],
    'Localidade': ['Town', 'Localidad', 'Localité', 'Ort'],
    'Código postal': ['Postcode', 'Código postal', 'Code postal', 'Postleitzahl'],
    'Confirmo que a morada está correta:': ['I confirm the address is correct:', 'Confirmo que la dirección es correcta:', 'Je confirme que l’adresse est correcte :', 'Ich bestätige, dass die Adresse stimmt:'],
    'Se a morada estiver errada, o pedido pode não chegar. Confira antes de enviar.': ['If the address is wrong, the order may not arrive. Please check before sending.', 'Si la dirección es incorrecta, el pedido puede no llegar. Revísala antes de enviar.', 'Si l’adresse est erronée, la commande risque de ne pas arriver. Vérifiez avant d’envoyer.', 'Wenn die Adresse falsch ist, kommt die Bestellung vielleicht nicht an. Bitte vor dem Senden prüfen.'],
    'A calcular a entrega para a sua morada…': ['Calculating delivery for your address…', 'Calculando el envío a tu dirección…', 'Calcul de la livraison pour votre adresse…', 'Lieferung zu deiner Adresse wird berechnet…'],
    'Entrega para a sua morada:': ['Delivery to your address:', 'Envío a tu dirección:', 'Livraison à votre adresse :', 'Lieferung zu deiner Adresse:'],
    'GRÁTIS 🎃': ['FREE 🎃', 'GRATIS 🎃', 'GRATUITE 🎃', 'GRATIS 🎃'],
    'Esta morada fica numa zona de entrega mais cara.': ['This address is in a more expensive delivery zone.', 'Esta dirección está en una zona de entrega más cara.', 'Cette adresse se trouve dans une zone de livraison plus chère.', 'Diese Adresse liegt in einer teureren Lieferzone.'],
    'A empresa de entregas cobra mais para lá chegar.': ['The delivery company charges more to get there.', 'La empresa de reparto cobra más por llegar allí.', 'La société de livraison facture plus cher pour s’y rendre.', 'Der Lieferdienst verlangt mehr, um dorthin zu fahren.'],
    'Quer pagar': ['Would you like to pay', '¿Quieres pagar', 'Voulez-vous payer', 'Möchtest du'],
    'de taxa de entrega, ou prefere a retirada?': ['for delivery, or would you rather pick it up?', 'de gastos de envío o prefieres recogerlo?', 'de frais de livraison, ou préférez-vous le retrait ?', 'Liefergebühr zahlen oder lieber abholen?'],
    'Aceito, quero entrega': ['Yes, deliver it', 'Acepto, quiero entrega', 'J’accepte, je veux la livraison', 'Ja, bitte liefern'],
    'Prefiro retirada': ['I’d rather pick it up', 'Prefiero recogerlo', 'Je préfère le retrait', 'Lieber abholen'],
    'Ainda não entregamos nessa morada': ['We don’t deliver to that address yet', 'Aún no entregamos en esa dirección', 'Nous ne livrons pas encore à cette adresse', 'An diese Adresse liefern wir noch nicht'],
    '— fica longe demais da nossa cozinha para chegar quente e a tempo. Pode escolher': ['— it’s too far from our kitchen to arrive hot and on time. You can choose', '— está demasiado lejos de nuestra cocina para llegar caliente y a tiempo. Puedes elegir', '— elle est trop loin de notre cuisine pour arriver chaud et à temps. Vous pouvez choisir le', '– sie ist zu weit von unserer Küche entfernt, um heiß und pünktlich anzukommen. Du kannst'],
    ', se quiser.': [', if you like.', ', si quieres.', ', si vous le souhaitez.', ' wählen, wenn du möchtest.'],
    'Não consegui confirmar a entrega agora.': ['We couldn’t confirm delivery right now.', 'No pudimos confirmar la entrega ahora.', 'Impossible de confirmer la livraison pour le moment.', 'Wir konnten die Lieferung gerade nicht bestätigen.'],
    'Tente novamente daqui a pouco, ou escolha': ['Try again in a moment, or choose', 'Inténtalo de nuevo en un momento o elige', 'Réessayez dans un instant ou choisissez le', 'Versuch es gleich nochmal oder wähle'],
    'Seu nome': ['Your name', 'Tu nombre', 'Votre nom', 'Dein Name'],
    'Nome completo': ['Full name', 'Nombre completo', 'Nom complet', 'Vollständiger Name'],
    'Para sabermos a quem entregar.': ['So we know who to deliver to.', 'Para saber a quién entregar.', 'Pour savoir à qui livrer.', 'Damit wir wissen, an wen wir liefern.'],
    'Seu WhatsApp': ['Your WhatsApp', 'Tu WhatsApp', 'Votre WhatsApp', 'Deine WhatsApp-Nummer'],
    'Seu número de WhatsApp': ['Your WhatsApp number', 'Tu número de WhatsApp', 'Votre numéro WhatsApp', 'Deine WhatsApp-Nummer'],
    'Ex.: +351 912 345 678': ['E.g.: +351 912 345 678', 'Ej.: +351 912 345 678', 'Ex. : +351 912 345 678', 'z. B.: +351 912 345 678'],
    'Para avisarmos quando o pedido estiver a caminho, e para o estafeta poder ligar se não encontrar a morada.': ['So we can tell you when the order is on its way, and the driver can call if they can’t find the address.', 'Para avisarte cuando el pedido esté en camino y para que el repartidor pueda llamar si no encuentra la dirección.', 'Pour vous prévenir quand la commande est en route, et pour que le livreur puisse appeler s’il ne trouve pas l’adresse.', 'Damit wir dir Bescheid geben, wenn die Bestellung unterwegs ist, und der Fahrer anrufen kann, falls er die Adresse nicht findet.'],
    'Esse número não parece certo — comece com + e o indicativo do país (ex.: +351 912 345 678). Sem indicativo não conseguimos entrar em contato se houver algum problema.': ['This number doesn’t look right — start with + and the country code (e.g. +351 912 345 678). Without the country code we can’t reach you if there’s a problem.', 'Este número no parece correcto: empieza con + y el prefijo del país (p. ej., +351 912 345 678). Sin el prefijo no podemos contactarte si hay algún problema.', 'Ce numéro ne semble pas correct — commencez par + et l’indicatif du pays (ex. : +351 912 345 678). Sans indicatif, nous ne pouvons pas vous joindre en cas de problème.', 'Diese Nummer scheint nicht zu stimmen – beginne mit + und der Landesvorwahl (z. B. +351 912 345 678). Ohne Vorwahl können wir dich bei Problemen nicht erreichen.'],
    'Pagamento': ['Payment', 'Pago', 'Paiement', 'Zahlung'],
    'Dinheiro': ['Cash', 'Efectivo', 'Espèces', 'Bar'],
    'Pagamento por MB Way antes do envio.': ['MB Way payment before dispatch (Portuguese mobile payment).', 'Pago por MB Way antes del envío (pago móvil portugués).', 'Paiement par MB Way avant l’envoi (paiement mobile portugais).', 'Zahlung per MB Way vor dem Versand (portugiesische Mobile-Payment-App).'],
    'Pagamento por MB Way antes de vir buscar.': ['MB Way payment before pick-up (Portuguese mobile payment).', 'Pago por MB Way antes de recoger (pago móvil portugués).', 'Paiement par MB Way avant le retrait (paiement mobile portugais).', 'Zahlung per MB Way vor der Abholung (portugiesische Mobile-Payment-App).'],
    'Pagamento por MB Way antes do envio: envia': ['MB Way payment before dispatch: send', 'Pago por MB Way antes del envío: envía', 'Paiement par MB Way avant l’envoi : envoyez', 'Zahlung per MB Way vor dem Versand: Sende'],
    'Pagamento por MB Way antes de vir buscar: envia': ['MB Way payment before pick-up: send', 'Pago por MB Way antes de recoger: envía', 'Paiement par MB Way avant le retrait : envoyez', 'Zahlung per MB Way vor der Abholung: Sende'],
    'para o': ['to', 'al', 'au', 'an die'],
    'e manda aqui no WhatsApp o comprovativo.': ['and send the receipt here on WhatsApp.', 'y envía aquí por WhatsApp el comprobante.', 'et envoyez le justificatif ici sur WhatsApp.', 'und schick uns den Beleg hier per WhatsApp.'],
    'Paga em dinheiro ao estafeta no momento da entrega.': ['Pay the driver in cash on delivery.', 'Pagas en efectivo al repartidor en el momento de la entrega.', 'Paiement en espèces au livreur à la livraison.', 'Bezahlung in bar beim Fahrer bei Lieferung.'],
    'Pagas em dinheiro ao buscar o pedido.': ['Pay in cash when you pick up the order.', 'Pagas en efectivo al recoger el pedido.', 'Paiement en espèces au retrait de la commande.', 'Bezahlung in bar bei Abholung.'],
    'Preciso de troco': ['I need change', 'Necesito cambio', 'J’ai besoin de monnaie', 'Ich brauche Wechselgeld'],
    'Diga o valor da nota com que vai pagar (ex.: 50€) — a gente já calcula o troco na hora, pronto tanto para a entrega quanto para quando você vier buscar.': ['Tell us which note you’ll pay with (e.g. €50) — we’ll work out the change right away, ready for delivery or for when you pick up.', 'Dinos con qué billete vas a pagar (ej.: 50 €) y calculamos el cambio al momento, listo tanto para la entrega como para cuando vengas a recogerlo.', 'Indiquez le billet avec lequel vous allez payer (ex. : 50 €) — nous calculons la monnaie tout de suite, prête pour la livraison ou pour votre retrait.', 'Sag uns, mit welchem Schein du zahlst (z. B. 50 €) – wir rechnen das Wechselgeld sofort aus, bereit für die Lieferung oder die Abholung.'],
    'Ex.: 50': ['E.g. 50', 'Ej.: 50', 'Ex. : 50', 'z. B. 50'],
    'Nota com que vai pagar, em euros': ['Note you’ll pay with, in euros', 'Billete con el que vas a pagar, en euros', 'Billet avec lequel vous allez payer, en euros', 'Schein, mit dem du zahlst, in Euro'],
    '⚠️ Não garantimos troco para notas tão altas. Prefere pagar por MB Way? Se não der, fala com a gente no WhatsApp antes de enviar, para confirmarmos se temos troco disponível.': ['⚠️ We can’t guarantee change for such large notes. Would you rather pay by MB Way? If not, message us on WhatsApp before sending so we can confirm we have change.', '⚠️ No garantizamos cambio para billetes tan grandes. ¿Prefieres pagar por MB Way? Si no puedes, escríbenos por WhatsApp antes de enviar para confirmar si tenemos cambio.', '⚠️ Nous ne garantissons pas la monnaie pour de si gros billets. Vous préférez payer par MB Way ? Sinon, écrivez-nous sur WhatsApp avant d’envoyer pour vérifier que nous avons la monnaie.', '⚠️ Bei so großen Scheinen können wir kein Wechselgeld garantieren. Lieber per MB Way zahlen? Sonst schreib uns vor dem Senden per WhatsApp, damit wir prüfen, ob wir genug Wechselgeld haben.'],
    'Observações (opcional)': ['Notes (optional)', 'Observaciones (opcional)', 'Remarques (facultatif)', 'Anmerkungen (optional)'],
    'Observações sobre o pedido': ['Order notes', 'Observaciones del pedido', 'Remarques sur la commande', 'Anmerkungen zur Bestellung'],
    'Alguma observação sobre o pedido? Ex.: alergia a algum ingrediente, preferência, ponto de referência...': ['Any notes about your order? E.g. an allergy, a preference, a landmark...', '¿Alguna observación sobre el pedido? Ej.: alergia a algún ingrediente, preferencia, punto de referencia...', 'Une remarque sur la commande ? Ex. : allergie, préférence, point de repère...', 'Anmerkungen zur Bestellung? z. B. Allergie, Vorlieben, Orientierungspunkt...'],
    'Tenho um código promocional': ['I have a promo code', 'Tengo un código promocional', 'J’ai un code promo', 'Ich habe einen Gutscheincode'],
    'Código': ['Code', 'Código', 'Code', 'Code'],
    'Código promocional': ['Promo code', 'Código promocional', 'Code promo', 'Gutscheincode'],
    'Aplicar': ['Apply', 'Aplicar', 'Appliquer', 'Einlösen'],
    'Código inválido.': ['Invalid code.', 'Código no válido.', 'Code invalide.', 'Ungültiger Code.'],
    'Este código já foi usado.': ['This code has already been used.', 'Este código ya se ha usado.', 'Ce code a déjà été utilisé.', 'Dieser Code wurde bereits verwendet.'],
    'Este código deixou de ser válido para este pedido.': ['This code is no longer valid for this order.', 'Este código ya no es válido para este pedido.', 'Ce code n’est plus valable pour cette commande.', 'Dieser Code gilt für diese Bestellung nicht mehr.'],
    'Este código já não é válido. Tente outra vez sem ele, ou fale com a gente.': ['This code is no longer valid. Try again without it, or talk to us.', 'Este código ya no es válido. Inténtalo de nuevo sin él o habla con nosotros.', 'Ce code n’est plus valable. Réessayez sans, ou contactez-nous.', 'Dieser Code ist nicht mehr gültig. Versuch es ohne ihn oder sprich mit uns.'],
    'Este código não acumula com a promoção de bebida grátis (10+ esfihas).': ['This code can’t be combined with the free-drink deal (10+ esfihas).', 'Este código no se acumula con la promoción de bebida gratis (10+ esfihas).', 'Ce code n’est pas cumulable avec la promo boisson offerte (10+ esfihas).', 'Dieser Code ist nicht mit dem Gratis-Getränk-Angebot (ab 10 Esfihas) kombinierbar.'],
    'Este código não é válido com combos.': ['This code isn’t valid with combos.', 'Este código no es válido con combos.', 'Ce code n’est pas valable avec les menus.', 'Dieser Code gilt nicht für Combos.'],
    'Não foi possível verificar agora. Tenta de novo.': ['Couldn’t check right now. Please try again.', 'No se pudo comprobar ahora. Inténtalo de nuevo.', 'Vérification impossible pour le moment. Réessayez.', 'Konnte gerade nicht geprüft werden. Bitte nochmal versuchen.'],
    '🎁 Este pedido fica grátis — código promocional aplicado.': ['🎁 This order is free — promo code applied.', '🎁 Este pedido sale gratis: código promocional aplicado.', '🎁 Cette commande est offerte — code promo appliqué.', '🎁 Diese Bestellung ist gratis – Gutscheincode eingelöst.'],
    'Total estimado': ['Estimated total', 'Total estimado', 'Total estimé', 'Voraussichtliche Summe'],
    '📲 Enviar pedido no WhatsApp': ['📲 Send order on WhatsApp', '📲 Enviar pedido por WhatsApp', '📲 Envoyer la commande sur WhatsApp', '📲 Bestellung per WhatsApp senden'],
    'A enviar…': ['Sending…', 'Enviando…', 'Envoi…', 'Wird gesendet…'],
    'Fechado por agora': ['Closed for now', 'Cerrado por ahora', 'Fermé pour l’instant', 'Vorerst geschlossen'],
    'Copiar pedido': ['Copy order', 'Copiar pedido', 'Copier la commande', 'Bestellung kopieren'],
    'Copiado!': ['Copied!', '¡Copiado!', 'Copié !', 'Kopiert!'],
    'Copiar link': ['Copy link', 'Copiar enlace', 'Copier le lien', 'Link kopieren'],
    'Pedido enviado! 🫓': ['Order sent! 🫓', '¡Pedido enviado! 🫓', 'Commande envoyée ! 🫓', 'Bestellung gesendet! 🫓'],
    'Acompanhe aqui, em tempo real:': ['Track it here in real time:', 'Síguelo aquí en tiempo real:', 'Suivez-la ici en temps réel :', 'Hier live verfolgen:'],
    'Seu pedido só é confirmado depois de enviado e recebido no WhatsApp.': ['Your order is only confirmed once it’s sent and received on WhatsApp.', 'Tu pedido solo se confirma después de enviarlo y recibirlo por WhatsApp.', 'Votre commande n’est confirmée qu’une fois envoyée et reçue sur WhatsApp.', 'Deine Bestellung ist erst bestätigt, wenn sie per WhatsApp gesendet und empfangen wurde.'],
    '⭐ Já pediu antes? Avalia a gente no Google': ['⭐ Ordered before? Review us on Google', '⭐ ¿Ya pediste antes? Valóranos en Google', '⭐ Déjà commandé ? Laissez-nous un avis sur Google', '⭐ Schon bestellt? Bewerte uns bei Google'],
    'Falar no WhatsApp': ['Chat on WhatsApp', 'Hablar por WhatsApp', 'Écrire sur WhatsApp', 'Per WhatsApp schreiben'],

    // ---- o que falta para enviar ----
    'Falta completar o pedido:': ['Your order is incomplete:', 'Falta completar el pedido:', 'Votre commande est incomplète :', 'Deine Bestellung ist noch unvollständig:'],
    'Falta escrever o seu nome.': ['Please enter your name.', 'Falta escribir tu nombre.', 'Indiquez votre nom.', 'Bitte gib deinen Namen ein.'],
    'O número de WhatsApp está incompleto ou errado — comece com + e o indicativo do país (ex.: +351 912 345 678). É por aí que entramos em contacto se houver algum problema.': ['The WhatsApp number is incomplete or wrong — start with + and the country code (e.g. +351 912 345 678). That’s how we get in touch if there’s a problem.', 'El número de WhatsApp está incompleto o es incorrecto: empieza con + y el prefijo del país (p. ej., +351 912 345 678). Así nos ponemos en contacto si hay algún problema.', 'Le numéro WhatsApp est incomplet ou erroné — commencez par + et l’indicatif du pays (ex. : +351 912 345 678). C’est ainsi que nous vous contactons en cas de problème.', 'Die WhatsApp-Nummer ist unvollständig oder falsch – beginne mit + und der Landesvorwahl (z. B. +351 912 345 678). So melden wir uns bei Problemen.'],
    'Troco: falta dizer com que nota você vai pagar.': ['Change: tell us which note you’ll pay with.', 'Cambio: falta decir con qué billete vas a pagar.', 'Monnaie : indiquez le billet avec lequel vous allez payer.', 'Wechselgeld: Sag uns, mit welchem Schein du zahlst.'],
    'Troco: a nota tem de ser maior ou igual ao total do pedido.': ['Change: the note must be equal to or more than the order total.', 'Cambio: el billete debe ser igual o mayor que el total del pedido.', 'Monnaie : le billet doit être supérieur ou égal au total de la commande.', 'Wechselgeld: Der Schein muss mindestens so hoch sein wie die Bestellsumme.'],
    'Entrega: falta escrever a morada completa (rua, número e andar).': ['Delivery: please enter the full address (street, number and floor).', 'Entrega: falta escribir la dirección completa (calle, número y piso).', 'Livraison : indiquez l’adresse complète (rue, numéro et étage).', 'Lieferung: Bitte gib die vollständige Adresse ein (Straße, Hausnummer und Stockwerk).'],
    'Entrega: falta escrever a localidade.': ['Delivery: please enter the town.', 'Entrega: falta escribir la localidad.', 'Livraison : indiquez la localité.', 'Lieferung: Bitte gib den Ort ein.'],
    'Entrega: falta o código postal, no formato 0000-000.': ['Delivery: the postcode is missing, in the format 0000-000.', 'Entrega: falta el código postal, con el formato 0000-000.', 'Livraison : il manque le code postal, au format 0000-000.', 'Lieferung: Die Postleitzahl fehlt, im Format 0000-000.'],
    'Entrega: não fazemos entrega para essa morada. Escolha retirada.': ['Delivery: we don’t deliver to that address. Choose pick-up.', 'Entrega: no entregamos en esa dirección. Elige recogida.', 'Livraison : nous ne livrons pas à cette adresse. Choisissez le retrait.', 'Lieferung: An diese Adresse liefern wir nicht. Wähle Abholung.'],
    'Entrega: falta escolher se aceita a taxa de entrega mais alta para esta morada, ou opte por retirada.': ['Delivery: choose whether you accept the higher delivery fee for this address, or opt for pick-up.', 'Entrega: falta elegir si aceptas los gastos de envío más altos para esta dirección o prefieres recogida.', 'Livraison : indiquez si vous acceptez les frais de livraison plus élevés pour cette adresse, ou optez pour le retrait.', 'Lieferung: Entscheide, ob du die höhere Liefergebühr für diese Adresse akzeptierst oder lieber abholst.'],
    'Entrega: falta confirmar a morada na caixa amarela.': ['Delivery: please confirm the address in the yellow box.', 'Entrega: falta confirmar la dirección en el recuadro amarillo.', 'Livraison : confirmez l’adresse dans l’encadré jaune.', 'Lieferung: Bitte bestätige die Adresse im gelben Feld.'],
    'Esfihas grátis: falta escolher o sabor de todas.': ['Free esfihas: choose a flavour for each one.', 'Esfihas gratis: falta elegir el sabor de todas.', 'Esfihas offertes : choisissez la saveur de chacune.', 'Gratis-Esfihas: Wähle für jede eine Sorte.'],
    'Bebida de 1L grátis: falta escolher qual.': ['Free 1L drink: choose which one.', 'Bebida de 1 L gratis: falta elegir cuál.', 'Boisson de 1 L offerte : choisissez laquelle.', 'Gratis-Getränk 1 l: Wähle eines aus.'],
    'Não foi possível enviar o pedido. Confira o nome e o WhatsApp e tente outra vez.': ['We couldn’t send the order. Check your name and WhatsApp number and try again.', 'No se pudo enviar el pedido. Revisa el nombre y el WhatsApp e inténtalo de nuevo.', 'Impossible d’envoyer la commande. Vérifiez le nom et le numéro WhatsApp et réessayez.', 'Die Bestellung konnte nicht gesendet werden. Prüf Name und WhatsApp-Nummer und versuch es nochmal.'],
    'O valor do pedido não ficou certo. Recarregue a página, monte o pedido de novo e tente enviar outra vez. Se continuar, fale com a gente pelo WhatsApp.': ['The order amount didn’t come out right. Reload the page, build the order again and try sending it again. If it keeps happening, talk to us on WhatsApp.', 'El importe del pedido no salió bien. Recarga la página, vuelve a armar el pedido e intenta enviarlo otra vez. Si sigue pasando, escríbenos por WhatsApp.', 'Le montant de la commande n’est pas correct. Rechargez la page, refaites la commande et réessayez. Si le problème persiste, contactez-nous sur WhatsApp.', 'Der Bestellbetrag stimmt nicht. Lade die Seite neu, stell die Bestellung nochmal zusammen und sende sie erneut. Wenn es weiter passiert, schreib uns per WhatsApp.'],
    'O código promocional deixou de ser válido. Veja a nota junto ao campo do código.': ['The promo code is no longer valid. See the note next to the code field.', 'El código promocional ya no es válido. Mira la nota junto al campo del código.', 'Le code promo n’est plus valable. Voir la note à côté du champ du code.', 'Der Gutscheincode ist nicht mehr gültig. Siehe Hinweis neben dem Codefeld.'],

    // ---- horario, fecho, rodape ----
    'Agora estamos fechados.': ['We’re closed right now.', 'Ahora estamos cerrados.', 'Nous sommes fermés pour le moment.', 'Wir haben gerade geschlossen.'],
    'Horário': ['Opening hours', 'Horario', 'Horaires', 'Öffnungszeiten'],
    'Segunda a quinta': ['Monday to Thursday', 'De lunes a jueves', 'Du lundi au jeudi', 'Montag bis Donnerstag'],
    'Sexta': ['Friday', 'Viernes', 'Vendredi', 'Freitag'],
    'Sábado': ['Saturday', 'Sábado', 'Samedi', 'Samstag'],
    'Domingo': ['Sunday', 'Domingo', 'Dimanche', 'Sonntag'],
    'Fechado': ['Closed', 'Cerrado', 'Fermé', 'Geschlossen'],
    'domingo': ['Sunday', 'domingo', 'dimanche', 'Sonntag'],
    'segunda-feira': ['Monday', 'lunes', 'lundi', 'Montag'],
    'terça-feira': ['Tuesday', 'martes', 'mardi', 'Dienstag'],
    'quarta-feira': ['Wednesday', 'miércoles', 'mercredi', 'Mittwoch'],
    'quinta-feira': ['Thursday', 'jueves', 'jeudi', 'Donnerstag'],
    'sexta-feira': ['Friday', 'viernes', 'vendredi', 'Freitag'],
    'sábado': ['Saturday', 'sábado', 'samedi', 'Samstag'],
    'Informação legal': ['Legal information', 'Información legal', 'Informations légales', 'Rechtliche Hinweise'],
    'Privacidade': ['Privacy', 'Privacidad', 'Confidentialité', 'Datenschutz'],
    'Termos': ['Terms', 'Condiciones', 'Conditions', 'AGB'],
    'Resolução': ['Disputes', 'Resolución de conflictos', 'Litiges', 'Streitbeilegung'],
    'Titular da atividade: Letícia Gonçalves Machado · NIF 298630338': ['Business owner: Letícia Gonçalves Machado · Tax no. (NIF) 298630338', 'Titular de la actividad: Letícia Gonçalves Machado · NIF 298630338', 'Titulaire de l’activité : Letícia Gonçalves Machado · NIF 298630338', 'Inhaberin: Letícia Gonçalves Machado · Steuernummer (NIF) 298630338'],
    'Contato: 938 211 480 (WhatsApp) · esfihadacasaptm@gmail.com': ['Contact: 938 211 480 (WhatsApp) · esfihadacasaptm@gmail.com', 'Contacto: 938 211 480 (WhatsApp) · esfihadacasaptm@gmail.com', 'Contact : 938 211 480 (WhatsApp) · esfihadacasaptm@gmail.com', 'Kontakt: 938 211 480 (WhatsApp) · esfihadacasaptm@gmail.com'],
    'Reclamações:': ['Complaints:', 'Reclamaciones:', 'Réclamations :', 'Beschwerden:'],
    'Livro de Reclamações Eletrónico': ['Electronic Complaints Book (Livro de Reclamações)', 'Libro de Reclamaciones Electrónico', 'Livre de réclamations électronique', 'Elektronisches Beschwerdebuch (Livro de Reclamações)'],
    '— tem direito a reclamar diretamente aqui.': ['— you have the right to file a complaint directly here.', '— tienes derecho a reclamar directamente aquí.', '— vous avez le droit de déposer une réclamation directement ici.', '— du hast das Recht, dich direkt hier zu beschweren.'],
    'Produtos alimentícios feitos artesanalmente. Todas as esfihas contêm glúten. Os alérgenos de cada sabor estão indicados no cardápio. Tudo é preparado na mesma cozinha, então pode ter traços de outros alérgenos. Se você tem alguma alergia, avisa a gente antes de pedir.': ['Handmade food products. All esfihas contain gluten. The allergens in each flavour are listed on the menu. Everything is prepared in the same kitchen, so it may contain traces of other allergens. If you have an allergy, let us know before ordering.', 'Productos alimenticios artesanales. Todas las esfihas contienen gluten. Los alérgenos de cada sabor se indican en la carta. Todo se prepara en la misma cocina, por lo que puede contener trazas de otros alérgenos. Si tienes alguna alergia, avísanos antes de pedir.', 'Produits alimentaires artisanaux. Toutes les esfihas contiennent du gluten. Les allergènes de chaque saveur sont indiqués sur la carte. Tout est préparé dans la même cuisine, des traces d’autres allergènes sont donc possibles. Si vous avez une allergie, prévenez-nous avant de commander.', 'Handgemachte Lebensmittel. Alle Esfihas enthalten Gluten. Die Allergene jeder Sorte stehen auf der Karte. Alles wird in derselben Küche zubereitet, daher können Spuren anderer Allergene enthalten sein. Wenn du eine Allergie hast, sag uns vor der Bestellung Bescheid.'],
    'Responsável pelo tratamento de dados:': ['Data controller:', 'Responsable del tratamiento de datos:', 'Responsable du traitement des données :', 'Verantwortlich für die Datenverarbeitung:'],
    'Letícia Gonçalves Machado (NIF 298630338), titular da Esfiha da Casa. Contato: 938 211 480 (WhatsApp) ou esfihadacasaptm@gmail.com.': ['Letícia Gonçalves Machado (NIF 298630338), owner of Esfiha da Casa. Contact: 938 211 480 (WhatsApp) or esfihadacasaptm@gmail.com.', 'Letícia Gonçalves Machado (NIF 298630338), titular de Esfiha da Casa. Contacto: 938 211 480 (WhatsApp) o esfihadacasaptm@gmail.com.', 'Letícia Gonçalves Machado (NIF 298630338), titulaire d’Esfiha da Casa. Contact : 938 211 480 (WhatsApp) ou esfihadacasaptm@gmail.com.', 'Letícia Gonçalves Machado (NIF 298630338), Inhaberin von Esfiha da Casa. Kontakt: 938 211 480 (WhatsApp) oder esfihadacasaptm@gmail.com.'],
    'Ao enviar seu pedido, seu nome, telefone e morada (quando for entrega) ficam guardados no nosso sistema de pedidos, só para preparar, entregar e dar suporte ao seu pedido. A mensagem final também é enviada por você pelo WhatsApp, que é um serviço fornecido pela Meta — a conversa fica guardada lá também, sujeita à política de privacidade da própria Meta.': ['When you send your order, your name, phone number and address (for delivery) are stored in our order system, only to prepare, deliver and support your order. The final message is also sent by you via WhatsApp, a service provided by Meta — the conversation is stored there too, subject to Meta’s own privacy policy.', 'Al enviar tu pedido, tu nombre, teléfono y dirección (si es entrega) se guardan en nuestro sistema de pedidos, solo para preparar, entregar y dar soporte a tu pedido. El mensaje final también lo envías tú por WhatsApp, un servicio de Meta: la conversación también queda guardada allí, sujeta a la política de privacidad de Meta.', 'Lorsque vous envoyez votre commande, votre nom, votre téléphone et votre adresse (en cas de livraison) sont enregistrés dans notre système de commandes, uniquement pour préparer, livrer et assurer le suivi de votre commande. Le message final est aussi envoyé par vous via WhatsApp, un service fourni par Meta — la conversation y est également conservée, soumise à la politique de confidentialité de Meta.', 'Wenn du deine Bestellung sendest, werden dein Name, deine Telefonnummer und deine Adresse (bei Lieferung) in unserem Bestellsystem gespeichert – nur um deine Bestellung zuzubereiten, zu liefern und zu betreuen. Die finale Nachricht sendest du außerdem selbst über WhatsApp, einen Dienst von Meta – der Chat wird auch dort gespeichert und unterliegt der Datenschutzrichtlinie von Meta.'],
    'Mantemos esses dados guardados no nosso sistema de pedidos durante, no máximo, 13 meses — depois desse prazo são apagados automaticamente.': ['We keep this data in our order system for a maximum of 13 months — after that it is deleted automatically.', 'Conservamos estos datos en nuestro sistema de pedidos durante un máximo de 13 meses; después se borran automáticamente.', 'Nous conservons ces données dans notre système de commandes pendant 13 mois au maximum — elles sont ensuite supprimées automatiquement.', 'Wir speichern diese Daten höchstens 13 Monate in unserem Bestellsystem – danach werden sie automatisch gelöscht.'],
    'Você tem direito a acessar, corrigir ou pedir a eliminação dos seus dados a qualquer momento, é só escrever no WhatsApp. Se não resolvermos, você pode reclamar à CNPD (Comissão Nacional de Proteção de Dados) —': ['You have the right to access, correct or request deletion of your data at any time — just write to us on WhatsApp. If we don’t resolve it, you can complain to the CNPD (Portuguese Data Protection Authority) —', 'Tienes derecho a acceder, corregir o pedir la eliminación de tus datos en cualquier momento, solo tienes que escribirnos por WhatsApp. Si no lo resolvemos, puedes reclamar ante la CNPD (autoridad portuguesa de protección de datos) —', 'Vous avez le droit d’accéder à vos données, de les corriger ou d’en demander la suppression à tout moment, il suffit de nous écrire sur WhatsApp. Si nous ne réglons pas la question, vous pouvez saisir la CNPD (autorité portugaise de protection des données) —', 'Du hast jederzeit das Recht auf Auskunft, Berichtigung oder Löschung deiner Daten – schreib uns einfach per WhatsApp. Lösen wir es nicht, kannst du dich bei der CNPD (portugiesische Datenschutzbehörde) beschweren —'],
    'A gente usa uma ferramenta de estatísticas que conta visitas de forma anônima e agregada, sem cookies e sem identificar ninguém. O site não tem publicidade nem perfis de usuário.': ['We use a statistics tool that counts visits anonymously and in aggregate, without cookies and without identifying anyone. The site has no advertising and no user profiles.', 'Usamos una herramienta de estadísticas que cuenta las visitas de forma anónima y agregada, sin cookies y sin identificar a nadie. El sitio no tiene publicidad ni perfiles de usuario.', 'Nous utilisons un outil de statistiques qui compte les visites de façon anonyme et agrégée, sans cookies et sans identifier personne. Le site n’a ni publicité ni profils d’utilisateur.', 'Wir nutzen ein Statistik-Tool, das Besuche anonym und zusammengefasst zählt – ohne Cookies und ohne jemanden zu identifizieren. Die Website hat weder Werbung noch Nutzerprofile.'],
    'Pedidos': ['Orders', 'Pedidos', 'Commandes', 'Bestellungen'],
    'Os pedidos são feitos e confirmados pelo WhatsApp. O pedido só vale depois da gente confirmar a disponibilidade e o valor final.': ['Orders are placed and confirmed via WhatsApp. An order only stands once we’ve confirmed availability and the final price.', 'Los pedidos se hacen y se confirman por WhatsApp. El pedido solo es válido cuando confirmamos la disponibilidad y el importe final.', 'Les commandes sont passées et confirmées via WhatsApp. Une commande n’est valable qu’après confirmation de la disponibilité et du prix final.', 'Bestellungen werden per WhatsApp aufgegeben und bestätigt. Eine Bestellung gilt erst, wenn wir Verfügbarkeit und Endpreis bestätigt haben.'],
    'Preços': ['Prices', 'Precios', 'Prix', 'Preise'],
    'O preço final soma automaticamente os extras que você escolher — cada extra tem o seu preço próprio, indicado no cardápio. A taxa de entrega é fixa (3,50€) e também é somada ao total.': ['The final price automatically adds the extras you choose — each extra has its own price, shown on the menu. The delivery fee is fixed (€3.50) and is also added to the total.', 'El precio final suma automáticamente los extras que elijas; cada extra tiene su propio precio, indicado en la carta. Los gastos de envío son fijos (3,50 €) y también se suman al total.', 'Le prix final inclut automatiquement les suppléments choisis — chaque supplément a son propre prix, indiqué sur la carte. Les frais de livraison sont fixes (3,50 €) et s’ajoutent aussi au total.', 'Der Endpreis rechnet die gewählten Extras automatisch dazu – jedes Extra hat seinen eigenen Preis, der auf der Karte steht. Die Liefergebühr ist fest (3,50 €) und wird ebenfalls zur Summe addiert.'],
    'Entregas': ['Deliveries', 'Entregas', 'Livraisons', 'Lieferungen'],
    'Entregamos nas regiões indicadas no site, dentro do horário de funcionamento. As entregas são feitas por nós mesmos, da Esfiha da Casa. O tempo de entrega varia com o volume de pedidos e a distância.': ['We deliver to the areas shown on the site, during opening hours. Deliveries are made by us, Esfiha da Casa. Delivery time depends on the number of orders and the distance.', 'Entregamos en las zonas indicadas en el sitio, dentro del horario de apertura. Las entregas las hacemos nosotros mismos, Esfiha da Casa. El tiempo de entrega depende del volumen de pedidos y de la distancia.', 'Nous livrons dans les zones indiquées sur le site, pendant les heures d’ouverture. Les livraisons sont assurées par nous-mêmes, Esfiha da Casa. Le délai dépend du volume de commandes et de la distance.', 'Wir liefern in die auf der Website genannten Gebiete, während der Öffnungszeiten. Die Lieferungen machen wir selbst, Esfiha da Casa. Die Lieferzeit hängt von der Anzahl der Bestellungen und der Entfernung ab.'],
    'Na entrega pode escolher MB Way (antes do envio) ou dinheiro (paga ao estafeta na entrega). Na retirada aceitamos MB Way ou dinheiro.': ['For delivery you can choose MB Way (before dispatch) or cash (paid to the driver on delivery). For pick-up we accept MB Way or cash.', 'En la entrega puedes elegir MB Way (antes del envío) o efectivo (se paga al repartidor en la entrega). En la recogida aceptamos MB Way o efectivo.', 'En livraison, vous pouvez choisir MB Way (avant l’envoi) ou les espèces (payées au livreur à la livraison). Au retrait, nous acceptons MB Way ou les espèces.', 'Bei Lieferung kannst du MB Way (vor dem Versand) oder Barzahlung (beim Fahrer bei Lieferung) wählen. Bei Abholung akzeptieren wir MB Way oder Bargeld.'],
    'Cancelamentos': ['Cancellations', 'Cancelaciones', 'Annulations', 'Stornierungen'],
    'Por serem alimentos feitos na hora, não se aplica o direito de desistência de 14 dias das compras à distância. Pode cancelar sem custo só enquanto o pedido ainda não começou a ser preparado. Depois de entrar em preparação, o valor é devido mesmo que desista — os ingredientes já foram usados.': ['As the food is made to order, the 14-day right of withdrawal for distance purchases does not apply. You can cancel free of charge only while the order hasn’t started being prepared. Once preparation has begun, the amount is due even if you cancel — the ingredients have already been used.', 'Al tratarse de alimentos hechos al momento, no se aplica el derecho de desistimiento de 14 días de las compras a distancia. Puedes cancelar sin coste solo mientras el pedido no haya empezado a prepararse. Una vez en preparación, el importe se debe aunque desistas: los ingredientes ya se han usado.', 'Les plats étant préparés à la demande, le droit de rétractation de 14 jours des achats à distance ne s’applique pas. Vous pouvez annuler sans frais uniquement tant que la préparation n’a pas commencé. Une fois la préparation lancée, le montant reste dû même en cas d’annulation — les ingrédients ont déjà été utilisés.', 'Da die Speisen frisch zubereitet werden, gilt das 14-tägige Widerrufsrecht für Fernkäufe nicht. Kostenlos stornieren kannst du nur, solange die Zubereitung noch nicht begonnen hat. Danach ist der Betrag auch bei Stornierung fällig – die Zutaten wurden bereits verwendet.'],
    'Resolução de problemas': ['Problem resolution', 'Resolución de problemas', 'Résolution des problèmes', 'Problemlösung'],
    'Se alguma coisa der errado com seu pedido — item trocado, que faltou, ou que não chegou como devia — fale com a gente no WhatsApp até 30 minutos depois de receber o pedido.': ['If anything goes wrong with your order — a wrong item, something missing, or something that didn’t arrive as it should — message us on WhatsApp within 30 minutes of receiving the order.', 'Si algo sale mal con tu pedido —un producto cambiado, algo que falta o que no llegó como debía—, escríbenos por WhatsApp en los 30 minutos siguientes a recibirlo.', 'Si quelque chose ne va pas avec votre commande — article erroné, manquant ou arrivé en mauvais état — écrivez-nous sur WhatsApp dans les 30 minutes suivant la réception.', 'Wenn mit deiner Bestellung etwas schiefgeht – falscher Artikel, etwas fehlt oder kam nicht so an, wie es sollte – schreib uns innerhalb von 30 Minuten nach Erhalt per WhatsApp.'],
    'Analisamos cada caso conforme a situação e decidimos com você a melhor forma de resolver.': ['We look at each case individually and decide with you the best way to resolve it.', 'Analizamos cada caso según la situación y decidimos contigo la mejor forma de resolverlo.', 'Nous examinons chaque cas et décidons avec vous de la meilleure solution.', 'Wir prüfen jeden Fall einzeln und entscheiden gemeinsam mit dir, wie wir es am besten lösen.'],
    'Se não chegarmos a um acordo, você pode recorrer a uma entidade de Resolução Alternativa de Litígios de Consumo, como o': ['If we can’t reach an agreement, you can turn to an Alternative Consumer Dispute Resolution body, such as the', 'Si no llegamos a un acuerdo, puedes acudir a una entidad de Resolución Alternativa de Litigios de Consumo, como el', 'Si nous ne parvenons pas à un accord, vous pouvez faire appel à un organisme de règlement extrajudiciaire des litiges de consommation, comme le', 'Wenn wir uns nicht einigen, kannst du dich an eine Stelle für alternative Verbraucherstreitbeilegung wenden, etwa an die'],
    'Centro de Arbitragem de Conflitos de Consumo do Algarve': ['Algarve Consumer Arbitration Centre (Centro de Arbitragem de Conflitos de Consumo do Algarve)', 'Centro de Arbitraje de Conflictos de Consumo del Algarve', 'Centre d’arbitrage des litiges de consommation de l’Algarve', 'Schlichtungsstelle für Verbraucherstreitigkeiten der Algarve (Centro de Arbitragem de Conflitos de Consumo do Algarve)'],
    'Sua opinião ajuda a gente a melhorar. Se tiver uma sugestão ou uma crítica, fale direto com a gente — a gente prefere saber.': ['Your feedback helps us improve. If you have a suggestion or criticism, talk to us directly — we’d rather know.', 'Tu opinión nos ayuda a mejorar. Si tienes una sugerencia o una crítica, háblanos directamente: preferimos saberlo.', 'Votre avis nous aide à progresser. Si vous avez une suggestion ou une critique, parlez-nous directement — nous préférons le savoir.', 'Deine Meinung hilft uns, besser zu werden. Wenn du einen Vorschlag oder Kritik hast, sag es uns direkt – wir wollen es lieber wissen.'],
    'Mascote Esfiha da Casa': ['Esfiha da Casa mascot', 'Mascota de Esfiha da Casa', 'Mascotte d’Esfiha da Casa', 'Maskottchen von Esfiha da Casa'],
    'Promoção de Halloween: entrega grátis e brinde para as crianças': ['Halloween special: free delivery and a treat for the kids', 'Promoción de Halloween: envío gratis y regalo para los niños', 'Promo Halloween : livraison gratuite et surprise pour les enfants', 'Halloween-Aktion: kostenlose Lieferung und eine Überraschung für die Kinder'],

    // ---- pagina de acompanhar o pedido (/pedido/) ----
    'A carregar…': ['Loading…', 'Cargando…', 'Chargement…', 'Wird geladen…'],
    'Pedido recebido': ['Order received', 'Pedido recibido', 'Commande reçue', 'Bestellung eingegangen'],
    'Chegou certinho. Já vamos confirmar e começar.': ['It arrived safely. We’ll confirm it and get started.', 'Llegó bien. Enseguida lo confirmamos y empezamos.', 'Bien reçue. Nous allons confirmer et commencer.', 'Ist gut angekommen. Wir bestätigen gleich und legen los.'],
    'A ser preparado': ['Being prepared', 'En preparación', 'En préparation', 'Wird zubereitet'],
    'A massa já está nas mãos. Sai quentinho daqui a pouco.': ['The dough is in our hands. It’ll be out hot very soon.', 'La masa ya está en nuestras manos. Sale calentito en un momento.', 'La pâte est entre nos mains. Ça sort bien chaud dans un instant.', 'Der Teig ist in Arbeit. Gleich kommt alles heiß aus dem Ofen.'],
    'A massa já está nas mãos. Avisamos quando puder vir.': ['The dough is in our hands. We’ll let you know when you can come.', 'La masa ya está en nuestras manos. Te avisamos cuando puedas venir.', 'La pâte est entre nos mains. Nous vous prévenons quand vous pourrez venir.', 'Der Teig ist in Arbeit. Wir sagen Bescheid, wenn du kommen kannst.'],
    'A caminho': ['On its way', 'En camino', 'En route', 'Unterwegs'],
    'Saiu para entrega. Fica atento ao celular.': ['Out for delivery. Keep an eye on your phone.', 'Ha salido para entrega. Atento al móvil.', 'Partie en livraison. Gardez un œil sur votre téléphone.', 'Ist unterwegs zu dir. Behalte dein Handy im Blick.'],
    'Entregue': ['Delivered', 'Entregado', 'Livrée', 'Geliefert'],
    'Bom apetite! Obrigado por pedir com a gente.': ['Enjoy your meal! Thanks for ordering from us.', '¡Buen provecho! Gracias por pedir con nosotros.', 'Bon appétit ! Merci d’avoir commandé chez nous.', 'Guten Appetit! Danke für deine Bestellung.'],
    'Pronto / retirado': ['Ready / picked up', 'Listo / recogido', 'Prêt / retiré', 'Fertig / abgeholt'],
    'Falta o código do pedido no link.': ['The order code is missing from the link.', 'Falta el código del pedido en el enlace.', 'Le code de commande manque dans le lien.', 'Im Link fehlt der Bestellcode.'],
    'Não encontramos esse pedido. Confirme o link, ou fale com a gente no WhatsApp.': ['We couldn’t find that order. Check the link, or talk to us on WhatsApp.', 'No encontramos ese pedido. Revisa el enlace o escríbenos por WhatsApp.', 'Commande introuvable. Vérifiez le lien ou contactez-nous sur WhatsApp.', 'Diese Bestellung haben wir nicht gefunden. Prüf den Link oder schreib uns per WhatsApp.'],
    'Pedido não encontrado': ['Order not found', 'Pedido no encontrado', 'Commande introuvable', 'Bestellung nicht gefunden'],
    'Pedido cancelado': ['Order cancelled', 'Pedido cancelado', 'Commande annulée', 'Bestellung storniert'],
    'Se isto parecer um engano, fale com a gente no WhatsApp.': ['If this looks like a mistake, talk to us on WhatsApp.', 'Si te parece un error, escríbenos por WhatsApp.', 'Si cela semble être une erreur, contactez-nous sur WhatsApp.', 'Wenn das ein Fehler zu sein scheint, schreib uns per WhatsApp.'],
    'Total': ['Total', 'Total', 'Total', 'Gesamt'],
    'pago': ['paid', 'pagado', 'payé', 'bezahlt'],
    'por pagar': ['unpaid', 'pendiente de pago', 'à payer', 'offen'],
    '⭐ Avaliar no Google': ['⭐ Review us on Google', '⭐ Valorar en Google', '⭐ Donner un avis sur Google', '⭐ Bei Google bewerten'],
    '🖨️ Guardar / imprimir recibo': ['🖨️ Save / print receipt', '🖨️ Guardar / imprimir recibo', '🖨️ Enregistrer / imprimer le reçu', '🖨️ Beleg speichern / drucken'],
    'Esta página atualiza sozinha.': ['This page updates by itself.', 'Esta página se actualiza sola.', 'Cette page se met à jour toute seule.', 'Diese Seite aktualisiert sich automatisch.'],
    'Pode deixá-la aberta e ir vendo.': ['You can leave it open and keep an eye on it.', 'Puedes dejarla abierta e ir mirando.', 'Vous pouvez la laisser ouverte et suivre.', 'Du kannst sie offen lassen und mitverfolgen.'],
    'Esfiha da Casa — site, política de privacidade e informação legal': ['Esfiha da Casa — website, privacy policy and legal information', 'Esfiha da Casa — web, política de privacidad e información legal', 'Esfiha da Casa — site, politique de confidentialité et informations légales', 'Esfiha da Casa – Website, Datenschutz und rechtliche Hinweise'],
    'Itens': ['Items', 'Productos', 'Articles', 'Artikel'],
    'Preço': ['Price', 'Precio', 'Prix', 'Preis'],
    'Subtotal': ['Subtotal', 'Subtotal', 'Sous-total', 'Zwischensumme'],
    'Taxa de entrega': ['Delivery fee', 'Gastos de envío', 'Frais de livraison', 'Liefergebühr'],
    'Total pago': ['Total paid', 'Total pagado', 'Total payé', 'Bezahlt gesamt'],
    'Confirmação de pagamento — recibo': ['Payment confirmation — receipt', 'Confirmación de pago — recibo', 'Confirmation de paiement — reçu', 'Zahlungsbestätigung – Beleg'],
  };

  // Padroes: frases com numeros, precos ou nomes no meio.
  // Cada um devolve a traducao (ou null). t() traduz um pedaco por dentro.
  function plural(n, um, varios) { return Number(n) === 1 ? um : varios; }
  var P = [
    [/^(.+) \+(\d+,\d{2}€)$/, function (m, L) { var n = t(m[1], L); return n ? n + ' +' + m[2] : null; }],
    [/^(\d+)\. (.+)$/, function (m, L) { var n = t(m[2], L); return n ? m[1] + '. ' + n : null; }],
    [/^Quantidade de (.+)$/, function (m, L) { var n = t(m[1], L) || m[1]; return { en: 'Quantity of ' + n, es: 'Cantidad de ' + n, fr: 'Quantité de ' + n, de: 'Menge: ' + n }[L]; }],
    [/^(\d+) esfihas, bebida grátis$/, function (m, L) { return { en: m[1] + ' esfihas, free drink', es: m[1] + ' esfihas, bebida gratis', fr: m[1] + ' esfihas, boisson offerte', de: m[1] + ' Esfihas, Getränk gratis' }[L]; }],
    [/^Promoção (\d+) esfihas$/, function (m, L) { return { en: m[1] + '-esfiha deal', es: 'Promoción ' + m[1] + ' esfihas', fr: 'Promo ' + m[1] + ' esfihas', de: m[1] + '-Esfihas-Angebot' }[L]; }],
    [/^Troco: (.+€)$/, function (m, L) { return { en: 'Change: ', es: 'Cambio: ', fr: 'Monnaie : ', de: 'Wechselgeld: ' }[L] + m[1]; }],
    [/^✅ Código aplicado — desconto de (.+)!$/, function (m, L) { return { en: '✅ Code applied — ' + m[1] + ' off!', es: '✅ Código aplicado: ¡descuento de ' + m[1] + '!', fr: '✅ Code appliqué — remise de ' + m[1] + ' !', de: '✅ Code eingelöst – ' + m[1] + ' Rabatt!' }[L]; }],
    [/^🎁 Desconto de (.+) aplicado \(código (.+)\) — falta pagar (.+)\.$/, function (m, L) { return { en: '🎁 ' + m[1] + ' discount applied (code ' + m[2] + ') — ' + m[3] + ' left to pay.', es: '🎁 Descuento de ' + m[1] + ' aplicado (código ' + m[2] + '): faltan ' + m[3] + ' por pagar.', fr: '🎁 Remise de ' + m[1] + ' appliquée (code ' + m[2] + ') — reste à payer : ' + m[3] + '.', de: '🎁 ' + m[1] + ' Rabatt abgezogen (Code ' + m[2] + ') – noch ' + m[3] + ' zu zahlen.' }[L]; }],
    [/^Este código precisa de pelo menos (\d+) esfihas no pedido\.$/, function (m, L) { return { en: 'This code needs at least ' + m[1] + ' esfihas in the order.', es: 'Este código necesita al menos ' + m[1] + ' esfihas en el pedido.', fr: 'Ce code nécessite au moins ' + m[1] + ' esfihas dans la commande.', de: 'Für diesen Code brauchst du mindestens ' + m[1] + ' Esfihas in der Bestellung.' }[L]; }],
    [/^Esgotou (.+) por hoje\. Escolha outro sabor\.$/, function (m, L) { var n = t(m[1], L) || m[1]; return { en: n + ' has sold out for today. Choose another flavour.', es: n + ' se ha agotado por hoy. Elige otro sabor.', fr: n + ' : épuisé pour aujourd’hui. Choisissez une autre saveur.', de: n + ' ist für heute ausverkauft. Wähl eine andere Sorte.' }[L]; }],
    [/^Esgotou (.+) \(restam (\d+)\)\. Tire esse sabor do pedido ou escolha outro\.$/, function (m, L) { var n = t(m[1], L) || m[1]; return { en: n + ' is running out (' + m[2] + ' left). Remove it from the order or choose another flavour.', es: n + ' se está agotando (quedan ' + m[2] + '). Quítalo del pedido o elige otro sabor.', fr: n + ' : bientôt épuisé (il en reste ' + m[2] + '). Retirez-le de la commande ou choisissez une autre saveur.', de: n + ' ist fast ausverkauft (noch ' + m[2] + '). Nimm die Sorte aus der Bestellung oder wähle eine andere.' }[L]; }],
    [/^Não temos esfihas suficientes em stock para este pedido \(restam (\S+), este pedido precisa de (\d+)\)\.$/, function (m, L) { return { en: 'We don’t have enough esfihas in stock for this order (' + m[1] + ' left, this order needs ' + m[2] + ').', es: 'No tenemos suficientes esfihas en stock para este pedido (quedan ' + m[1] + ' y este pedido necesita ' + m[2] + ').', fr: 'Nous n’avons pas assez d’esfihas en stock pour cette commande (il en reste ' + m[1] + ', cette commande en demande ' + m[2] + ').', de: 'Für diese Bestellung haben wir nicht genug Esfihas vorrätig (noch ' + m[1] + ', diese Bestellung braucht ' + m[2] + ').' }[L]; }],
    [/^(.+): falta escolher (.+)$/, function (m, L) {
      var partes = m[2].split(', ').map(function (p) {
        var x = p.match(/^(\d+) (salgada|doce|bebida)\(s\)$/);
        if (!x) return p;
        var w = { salgada: { en: 'savoury', es: 'salada(s)', fr: 'salée(s)', de: 'herzhafte' }, doce: { en: 'sweet', es: 'dulce(s)', fr: 'sucrée(s)', de: 'süße' }, bebida: { en: 'drink(s)', es: 'bebida(s)', fr: 'boisson(s)', de: 'Getränk(e)' } }[x[2]][L];
        return x[1] + ' ' + w;
      }).join(', ');
      return { en: m[1] + ': still to choose ' + partes, es: m[1] + ': falta elegir ' + partes, fr: m[1] + ' : reste à choisir ' + partes, de: m[1] + ': noch auszuwählen ' + partes }[L];
    }],
    [/^Faltam (\d+) esfihas? para ganhar 1 bebida de 1L grátis\.$/, function (m, L) { var n = m[1]; return { en: n + ' more ' + plural(n, 'esfiha', 'esfihas') + ' to get a free 1L drink.', es: plural(n, 'Te falta ', 'Te faltan ') + n + ' ' + plural(n, 'esfiha', 'esfihas') + ' para ganar 1 bebida de 1 L gratis.', fr: 'Plus que ' + n + ' ' + plural(n, 'esfiha', 'esfihas') + ' pour gagner une boisson de 1 L offerte.', de: 'Noch ' + n + ' ' + plural(n, 'Esfiha', 'Esfihas') + ' bis zum Gratis-Getränk (1 l).' }[L]; }],
    [/^Faltam (\d+) esfihas? para ganhar 2 esfihas grátis\. \(Só esfihas avulsas contam -- não acumula com combos nem outras promoções\.\)$/, function (m, L) { var n = m[1]; return { en: n + ' more ' + plural(n, 'esfiha', 'esfihas') + ' to get 2 free esfihas. (Only single esfihas count — not combinable with combos or other deals.)', es: plural(n, 'Te falta ', 'Te faltan ') + n + ' ' + plural(n, 'esfiha', 'esfihas') + ' para ganar 2 esfihas gratis. (Solo cuentan las esfihas sueltas; no acumulable con combos ni otras promociones.)', fr: 'Plus que ' + n + ' ' + plural(n, 'esfiha', 'esfihas') + ' pour gagner 2 esfihas offertes. (Seules les esfihas à l’unité comptent — non cumulable avec les menus ni d’autres promotions.)', de: 'Noch ' + n + ' ' + plural(n, 'Esfiha', 'Esfihas') + ' bis zu 2 Gratis-Esfihas. (Nur einzelne Esfihas zählen – nicht mit Combos oder anderen Angeboten kombinierbar.)' }[L]; }],
    [/^🎁 Esfiha grátis (\d+)\/(\d+)$/, function (m, L) { return { en: '🎁 Free esfiha ', es: '🎁 Esfiha gratis ', fr: '🎁 Esfiha offerte ', de: '🎁 Gratis-Esfiha ' }[L] + m[1] + '/' + m[2]; }],
    [/^Escolha (\d+) (salgadas \(no lugar dos doces\)|salgadas|doces) ?(.*)$/, function (m, L) {
      var tipo = { 'salgadas': { en: 'savoury', es: 'saladas', fr: 'salées', de: 'herzhafte' }, 'doces': { en: 'sweet', es: 'dulces', fr: 'sucrées', de: 'süße' }, 'salgadas (no lugar dos doces)': { en: 'savoury (instead of sweet)', es: 'saladas (en lugar de las dulces)', fr: 'salées (à la place des sucrées)', de: 'herzhafte (statt süßer)' } }[m[2]][L];
      return { en: 'Choose ', es: 'Elige ', fr: 'Choisissez ', de: 'Wähle ' }[L] + m[1] + ' ' + tipo + estadoEscolha(m[3], L);
    }],
    [/^Escolha (\d+) bebidas ?(.*)$/, function (m, L) { return { en: 'Choose ' + m[1] + ' drinks', es: 'Elige ' + m[1] + ' bebidas', fr: 'Choisissez ' + m[1] + ' boissons', de: 'Wähle ' + m[1] + ' Getränke' }[L] + estadoEscolha(m[2], L); }],
    [/^Escolha a bebida ?(.*)$/, function (m, L) { return { en: 'Choose the drink', es: 'Elige la bebida', fr: 'Choisissez la boisson', de: 'Wähle das Getränk' }[L] + estadoEscolha(m[1], L); }],
    [/^Escolha o sabor ?(.*)$/, function (m, L) { return { en: 'Choose the flavour', es: 'Elige el sabor', fr: 'Choisissez la saveur', de: 'Wähle die Sorte' }[L] + estadoEscolha(m[1], L); }],
    [/^🎁 Oferta de (?:1 bebida|(\d+) bebidas) (em lata|de 1L)$/, function (m, L) {
      var n = m[1] ? Number(m[1]) : 1, lata = m[2] === 'em lata', s = n > 1;
      return { en: '🎁 Includes ' + n + (lata ? ' canned drink' : ' 1L drink') + (s ? 's' : ''), es: '🎁 Incluye ' + n + ' bebida' + (s ? 's' : '') + (lata ? ' en lata' : ' de 1 L'), fr: '🎁 ' + n + ' boisson' + (s ? 's' : '') + (lata ? ' en canette' : ' de 1 L') + ' offerte' + (s ? 's' : ''), de: '🎁 Inklusive ' + n + (lata ? (s ? ' Dosengetränke' : ' Dosengetränk') : (s ? ' Getränke à 1 l' : ' Getränk à 1 l')) }[L];
    }],
    [/^Agora estamos fechados\. Voltamos a abrir (.+)\.$/, function (m, L) { var q = quando(m[1], L); if (!q) return null; return { en: 'We’re closed right now. We reopen ' + q + '.', es: 'Ahora estamos cerrados. Volvemos a abrir ' + q + '.', fr: 'Nous sommes fermés pour le moment. Réouverture ' + q + '.', de: 'Wir haben gerade geschlossen. Wir öffnen wieder ' + q + '.' }[L]; }],
    [/^(Entrega|Retirada) · pedido às (\d{1,2}:\d{2})$/, function (m, L) { var mo = t(m[1], L); return { en: mo + ' · ordered at ' + m[2], es: mo + ' · pedido a las ' + m[2], fr: mo + ' · commandé à ' + m[2], de: mo + ' · bestellt um ' + m[2] }[L]; }],
    [/^Recibo · Pedido #(\d+)$/, function (m, L) { return { en: 'Receipt · Order #', es: 'Recibo · Pedido #', fr: 'Reçu · Commande #', de: 'Beleg · Bestellung #' }[L] + m[1]; }],
    [/^Recibo: #(\d+)$/, function (m, L) { return { en: 'Receipt: #', es: 'Recibo: #', fr: 'Reçu : #', de: 'Beleg: #' }[L] + m[1]; }],
  ];

  function estadoEscolha(s, L) {
    s = (s || '').trim();
    if (!s) return '';
    if (s === '✓') return ' ✓';
    if (s === '(falta escolher)') return ' ' + { en: '(still to choose)', es: '(falta elegir)', fr: '(à choisir)', de: '(noch auswählen)' }[L];
    var x = s.match(/^\(faltam? (\d+)\)$/);
    if (x) return ' ' + { en: '(' + x[1] + ' left)', es: '(faltan ' + x[1] + ')', fr: '(encore ' + x[1] + ')', de: '(noch ' + x[1] + ')' }[L];
    return ' ' + s;
  }

  function quando(s, L) {
    var x;
    if ((x = s.match(/^hoje às (\d{1,2}:\d{2})$/))) return { en: 'today at ', es: 'hoy a las ', fr: 'aujourd’hui à ', de: 'heute um ' }[L] + x[1];
    if ((x = s.match(/^amanhã às (\d{1,2}:\d{2})$/))) return { en: 'tomorrow at ', es: 'mañana a las ', fr: 'demain à ', de: 'morgen um ' }[L] + x[1];
    if ((x = s.match(/^(.+), dia (\d{2}\/\d{2}), às (\d{1,2}:\d{2})$/))) {
      var dia = t(x[1], L) || x[1];
      return { en: 'on ' + dia + ' ' + x[2] + ' at ' + x[3], es: 'el ' + dia + ' ' + x[2] + ' a las ' + x[3], fr: dia + ' ' + x[2] + ' à ' + x[3], de: 'am ' + dia + ', ' + x[2] + ', um ' + x[3] }[L];
    }
    return null;
  }


  // ---- Portugues de Portugal (pe) ----
  // O texto-base do site esta em PT-BR (com algumas partes ja em PT-PT).
  // Para 'pe' aplicam-se frases exatas e, depois, regras de palavras.
  //PE-INICIO
  var PE_EXATO = {
    'Tem sabor que a gente não esquece.': 'Há sabores que não se esquecem.',
    'Salgadas pra quem ama o clássico, doces pra fechar com chave de ouro.': 'Salgadas para quem adora os clássicos, doces para terminar em grande.',
    'Tem certeza? Toque outra vez': 'Tem a certeza? Toque outra vez',
    'Você ainda não escolheu nada. Use os botões + nos sabores acima.': 'Ainda não escolheu nada. Use os botões + nos sabores acima.',
    'Como você quer receber?': 'Como quer receber?',
    'Todas as esfihas levam massa de trigo, então contêm glúten. O extra queijo (leite) também é alérgeno.': 'Todas as esfihas levam massa de trigo, pelo que contêm glúten. O extra de queijo (leite) também é um alergénio.',
    'Tudo é preparado na mesma cozinha, então pode ter traços de outros alérgenos. Se você tem alguma alergia, avisa a gente no WhatsApp antes de pedir.': 'Tudo é preparado na mesma cozinha, pelo que pode ter vestígios de outros alergénios. Se tem alguma alergia, avise-nos no WhatsApp antes de pedir.',
    'Diga o valor da nota com que vai pagar (ex.: 50€) — a gente já calcula o troco na hora, pronto tanto para a entrega quanto para quando você vier buscar.': 'Diga o valor da nota com que vai pagar (ex.: 50€) — calculamos logo o troco, tanto para a entrega como para quando vier buscar.',
    'Ao enviar seu pedido, seu nome, telefone e morada (quando for entrega) ficam guardados no nosso sistema de pedidos, só para preparar, entregar e dar suporte ao seu pedido. A mensagem final também é enviada por você pelo WhatsApp, que é um serviço fornecido pela Meta — a conversa fica guardada lá também, sujeita à política de privacidade da própria Meta.': 'Ao enviar o seu pedido, o seu nome, telefone e morada (quando for entrega) ficam guardados no nosso sistema de pedidos, apenas para preparar, entregar e dar apoio ao seu pedido. A mensagem final é também enviada por si pelo WhatsApp, um serviço fornecido pela Meta — a conversa fica igualmente guardada aí, sujeita à política de privacidade da própria Meta.',
    'Você tem direito a acessar, corrigir ou pedir a eliminação dos seus dados a qualquer momento, é só escrever no WhatsApp. Se não resolvermos, você pode reclamar à CNPD (Comissão Nacional de Proteção de Dados) —': 'Tem direito a aceder, corrigir ou pedir a eliminação dos seus dados a qualquer momento, basta escrever no WhatsApp. Se não resolvermos, pode reclamar à CNPD (Comissão Nacional de Proteção de Dados) —',
    'A gente usa uma ferramenta de estatísticas que conta visitas de forma anônima e agregada, sem cookies e sem identificar ninguém. O site não tem publicidade nem perfis de usuário.': 'Utilizamos uma ferramenta de estatísticas que conta visitas de forma anónima e agregada, sem cookies e sem identificar ninguém. O site não tem publicidade nem perfis de utilizador.',
    'Sua opinião ajuda a gente a melhorar. Se tiver uma sugestão ou uma crítica, fale direto com a gente — a gente prefere saber.': 'A sua opinião ajuda-nos a melhorar. Se tiver uma sugestão ou uma crítica, fale diretamente connosco — preferimos saber.'
  };
  var PE_ARTIGO_SEU = /(^|\s)(o|do|no|ao|pelo|um|os|dos|nos|aos|pelos)\s$/;
  var PE_ARTIGO_SUA = /(^|\s)(a|da|na|à|pela|uma|as|das|nas|às|pelas)\s$/;
  var PE_REGRAS = [
    [/\b([Nn])a retirada/g, '$1o levantamento'],
    [/\bda retirada/g, 'do levantamento'],
    [/\ba retirada/g, 'o levantamento'],
    [/\bà retirada/g, 'ao levantamento'],
    [/Retirada/g, 'Levantamento'],
    [/retirada/g, 'levantamento'],
    [/retirado/g, 'levantado'],
    [/levantamento combinada/g, 'levantamento combinado'],
    [/\bDelivery\b/g, 'Entrega'],
    [/\bdelivery\b/g, 'entrega'],
    [/(^|[.!?—]\s*)Você\s+(\S)/g, function (m, a, b) { return a + b.toUpperCase(); }],
    [/\b(por|para|a) você(?=\s|[.,;:!?]|$)/g, function (m, p) { return p === 'a' ? 'a si' : p + ' si'; }],
    [/\bcom você(?=\s|[.,;:!?]|$)/g, 'consigo'],
    [/\b[Vv]ocê\s+/g, ''],
    [/\b([Aa]visa|[Aa]vise|[Aa]juda|[Aa]valia|[Aa]valie) a gente(?=\s|[.,;:!?]|$)/g, '$1-nos'],
    [/alimentícios/g, 'alimentares'],
    [/\bcom a gente(?=\s|[.,;:!?]|$)/g, 'connosco'],
    [/\bA gente /g, 'Nós '],
    [/\ba gente /g, 'nós '],
    [/\bSeu(s?)(?=\s|[.,;:!?]|$)/g, function (m, pl) { return pl ? 'Os seus' : 'O seu'; }],
    [/\bSua(s?)(?=\s|[.,;:!?]|$)/g, function (m, pl) { return pl ? 'As suas' : 'A sua'; }],
    [/\bseu(s?)(?=\s|[.,;:!?]|$)/g, function (m, pl, off, str) { var b = str.slice(Math.max(0, off - 7), off).toLowerCase(); return PE_ARTIGO_SEU.test(b) ? m : (pl ? 'os ' : 'o ') + m; }],
    [/\bsua(s?)(?=\s|[.,;:!?]|$)/g, function (m, pl, off, str) { var b = str.slice(Math.max(0, off - 7), off).toLowerCase(); return PE_ARTIGO_SUA.test(b) ? m : (pl ? 'as ' : 'a ') + m; }],
    [/\b([Cc])ontato/g, '$1ontacto'],
    [/\bcelular\b/g, 'telemóvel'],
    [/\bno cardápio/g, 'na ementa'],
    [/\bdo cardápio/g, 'da ementa'],
    [/\bo cardápio/g, 'a ementa'],
    [/Cardápio/g, 'Ementa'],
    [/cardápio/g, 'ementa'],
    [/([Mm])ussarela/g, '$1ozarela'],
    [/([Aa])lérgeno/g, '$1lergénio'],
    [/\btraços\b/g, 'vestígios'],
    [/anônim/g, 'anónim'],
    [/\busuário/g, 'utilizador'],
    [/, então /g, ', pelo que '],
    [/\bdireto (no|com)\b/g, 'diretamente $1'],
    [/\b([Cc])onfira\b/g, function (m, c) { return c + 'onfirme'; }],
    [/\bacessar\b/g, 'aceder']
  ];
  function paraPE(s) {
    if (PE_EXATO[s]) return PE_EXATO[s];
    var r = s;
    for (var i = 0; i < PE_REGRAS.length; i++) r = r.replace(PE_REGRAS[i][0], PE_REGRAS[i][1]);
    return r === s ? null : r;
  }
  //PE-FIM

  // Traducao inversa (qualquer lingua -> PT), para quando o proprio site
  // repoe um texto que ja tinha sido traduzido (ex.: o botao de enviar).
  var INV = {};
  Object.keys(D).forEach(function (pt) { D[pt].forEach(function (tr) { if (!(tr in INV)) INV[tr] = pt; }); });

  Object.keys(EX.D).forEach(function (l) { Object.keys(EX.D[l]).forEach(function (pt) { var tr = EX.D[l][pt]; if (!(tr in INV)) INV[tr] = pt; }); });

  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
  function paraPt(s) { return D[s] ? s : (INV[s] || s); }

  function t(pt, L) {
    if (L === 'pt') return pt;
    if (L === 'pe') return paraPE(pt);
    if (EX.D[L]) {
      var vx = EX.D[L][pt];
      if (vx != null) return vx;
      return EX.pat ? EX.pat(pt, L, t) : null;
    }
    var row = D[pt];
    if (row) return row[COL[L]];
    for (var i = 0; i < P.length; i++) {
      var m = pt.match(P[i][0]);
      if (m) { var r = P[i][1](m, L); if (r) return r; }
    }
    return null;
  }

  // ---- aplicar a pagina ----
  var lang = 'pt';
  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  var SALTAR = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1 };

  function dentroDoSeletor(el) {
    while (el) { if (el.nodeType === 1 && el.hasAttribute && el.hasAttribute('data-no-i18n')) return true; el = el.parentNode; }
    return false;
  }

  function textoNo(n) {
    var par = n.parentNode;
    if (!par || SALTAR[par.nodeName] || dentroDoSeletor(par)) return;
    var v = n.nodeValue;
    if (v !== n.__i18nUlt) {
      // texto novo vindo do site: e este o original (em PT). Se o site
      // repos um texto ja traduzido, volta-se a chave PT pelo INV.
      n.__i18nPt = v;
      n.__i18nNorm = paraPt(norm(v));
    }
    if (!n.__i18nNorm) return;
    var orig = n.__i18nPt;
    var lead = (orig.match(/^\s*/) || [''])[0], trail = (orig.match(/\s*$/) || [''])[0];
    var pt = norm(orig) === n.__i18nNorm ? orig : lead + n.__i18nNorm + trail;
    var tr = lang === 'pt' ? null : t(n.__i18nNorm, lang);
    var alvo = tr == null ? pt : lead + tr + trail;
    n.__i18nUlt = alvo;
    if (n.nodeValue !== alvo) n.nodeValue = alvo;
  }

  function atributos(el) {
    if (dentroDoSeletor(el)) return;
    if (!el.__i18nA) el.__i18nA = {};
    ATTRS.forEach(function (a) {
      if (!el.hasAttribute(a)) return;
      var v = el.getAttribute(a);
      var st = el.__i18nA[a];
      if (!st || v !== st.ult) { st = el.__i18nA[a] = { pt: paraPt(norm(v)) }; }
      var alvo = lang === 'pt' ? st.pt : (t(st.pt, lang) || st.pt);
      st.ult = alvo;
      if (v !== alvo) el.setAttribute(a, alvo);
    });
  }

  function percorrer(root) {
    if (!root) return;
    if (root.nodeType === 3) { textoNo(root); return; }
    if (root.nodeType !== 1 || SALTAR[root.nodeName]) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var n; while ((n = w.nextNode())) textoNo(n);
    if (root.matches && root.matches('[placeholder],[aria-label],[title],[alt]')) atributos(root);
    if (root.querySelectorAll) root.querySelectorAll('[placeholder],[aria-label],[title],[alt]').forEach(atributos);
  }

  var tituloPt = null, tituloUlt = null;
  function titulo() {
    if (document.title !== tituloUlt) tituloPt = paraPt(norm(document.title));
    var alvo = lang === 'pt' ? tituloPt : (t(tituloPt, lang) || tituloPt);
    tituloUlt = alvo;
    if (document.title !== alvo) document.title = alvo;
  }

  var observando = false;
  function observar() {
    if (observando) return;
    observando = true;
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        if (m.type === 'characterData') textoNo(m.target);
        else if (m.type === 'attributes') { if (m.target.nodeType === 1) atributos(m.target); }
        else m.addedNodes.forEach(percorrer);
      });
      if (document.title !== tituloUlt) titulo();
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function aplicar(novo) {
    lang = novo;
    var info = LANGS.filter(function (l) { return l.id === novo; })[0] || LANGS[0];
    document.documentElement.lang = info.html;
    percorrer(document.body);
    titulo();
    atualizarBotao();
  }

  // ---- seletor (bandeira + seta) ----
  var botao, lista;
  function atualizarBotao() {
    if (!botao) return;
    var info = LANGS.filter(function (l) { return l.id === lang; })[0];
    botao.innerHTML = '<span class="i18n-flag">' + info.flag + '</span><span class="i18n-code">' + info.code + '</span><span class="i18n-seta">▾</span>';
    botao.setAttribute('aria-label', 'Idioma / Language: ' + info.nome);
    lista.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lang') === lang); });
  }

  function escolher(id) {
    try { localStorage.setItem(CHAVE, id); } catch (e) {}
    fecharLista();
    esconderSugestao();
    aplicar(id);
  }

  function fecharLista() { if (lista) { lista.hidden = true; botao.setAttribute('aria-expanded', 'false'); } }

  function estilos() {
    var css = '' +
      '.i18n-wrap{position:relative;display:inline-flex;font-family:inherit;z-index:30}' +
      '.i18n-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(58,31,18,.18);background:#fff;color:#3A1F12;border-radius:999px;padding:6px 10px;font:inherit;font-size:.85rem;font-weight:700;cursor:pointer;line-height:1}' +
      '.i18n-flag{font-size:1.05rem}.i18n-seta{font-size:.7rem;opacity:.7}' +
      '.i18n-list{position:absolute;right:0;top:calc(100% + 6px);background:#fff;border:1px solid rgba(58,31,18,.15);border-radius:12px;box-shadow:0 10px 28px rgba(58,31,18,.18);padding:6px;min-width:170px}' +
      '.i18n-list[hidden]{display:none}' +
      '.i18n-list button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:none;padding:9px 10px;border-radius:8px;font:inherit;font-size:.95rem;color:#3A1F12;cursor:pointer;text-align:left}' +
      '.i18n-list button:hover,.i18n-list button.on{background:#FFF3DC;font-weight:700}' +
      '.i18n-dir{display:flex;align-items:center;gap:8px}' +
      '.i18n-hdr{position:absolute;right:12px;top:50%;transform:translateY(-50%)}' +
      '.i18n-hdr .i18n-btn{background:rgba(255,255,255,.95)}' +
      '.i18n-fixo{position:fixed;right:12px;top:12px}' +
      '.i18n-sug{position:absolute;right:0;top:calc(100% + 8px);background:#3A1F12;color:#fff;border-radius:12px;padding:10px 12px;font-size:.88rem;width:220px;box-shadow:0 10px 28px rgba(0,0,0,.25)}' +
      '.i18n-sug p{margin:0 0 8px}.i18n-sug div{display:flex;gap:6px}' +
      '.i18n-sug button{flex:1;border:0;border-radius:8px;padding:7px 8px;font:inherit;font-size:.85rem;font-weight:700;cursor:pointer}' +
      '.i18n-sug .sim{background:#C8232B;color:#fff}.i18n-sug .nao{background:rgba(255,255,255,.15);color:#fff}' +
      '@media (max-width:440px){.i18n-code{display:none}.i18n-btn{padding:6px 8px;gap:3px}.i18n-dir{gap:6px}.top .brand span{white-space:nowrap}}' +
      '@media print{.i18n-wrap{display:none}}';
    var s = document.createElement('style');
    s.setAttribute('data-no-i18n', '');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function montarSeletor() {
    estilos();
    var wrap = document.createElement('div');
    wrap.className = 'i18n-wrap';
    wrap.setAttribute('data-no-i18n', '');
    botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'i18n-btn';
    botao.setAttribute('aria-haspopup', 'listbox');
    botao.setAttribute('aria-expanded', 'false');
    lista = document.createElement('div');
    lista.className = 'i18n-list';
    lista.hidden = true;
    LANGS.forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-lang', l.id);
      b.innerHTML = '<span class="i18n-flag">' + l.flag + '</span>' + l.nome;
      b.addEventListener('click', function () { escolher(l.id); });
      lista.appendChild(b);
    });
    botao.addEventListener('click', function (e) {
      e.stopPropagation();
      var abrir = lista.hidden;
      lista.hidden = !abrir;
      botao.setAttribute('aria-expanded', abrir ? 'true' : 'false');
      esconderSugestao();
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) fecharLista(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharLista(); });
    wrap.appendChild(botao);
    wrap.appendChild(lista);

    // Onde por: ao lado do "Aberto agora" no site; no canto do cabecalho
    // na pagina do pedido; senao, fixo no canto superior direito.
    var badge = document.getElementById('statusBadge');
    var hdr = document.querySelector('header');
    if (badge && badge.parentNode) {
      var dir = document.createElement('div');
      dir.className = 'i18n-dir';
      badge.parentNode.insertBefore(dir, badge);
      dir.appendChild(wrap);
      dir.appendChild(badge);
    } else if (hdr) {
      wrap.classList.add('i18n-hdr');
      hdr.appendChild(wrap);
    } else {
      wrap.classList.add('i18n-fixo');
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  // Sugestao discreta, uma vez, para quem tem o telemovel noutra lingua.
  var sugestao;
  var TXT_SUG = {
    en: ['View this page in English?', 'Yes', 'No thanks'],
    es: ['¿Ver esta página en español?', 'Sí', 'No, gracias'],
    fr: ['Afficher cette page en français ?', 'Oui', 'Non merci'],
    de: ['Diese Seite auf Deutsch anzeigen?', 'Ja', 'Nein danke'],
    pe: ['Ver esta página em português de Portugal?', 'Sim', 'Não, obrigado'],
  };
  Object.keys(EX.sug).forEach(function (k) { TXT_SUG[k] = EX.sug[k]; });
  function esconderSugestao() { if (sugestao) { sugestao.remove(); sugestao = null; } }
  function sugerir(wrap, id) {
    var tx = TXT_SUG[id];
    if (!tx) return;
    sugestao = document.createElement('div');
    sugestao.className = 'i18n-sug';
    sugestao.innerHTML = '<p>' + tx[0] + '</p><div><button type="button" class="sim">' + tx[1] + '</button><button type="button" class="nao">' + tx[2] + '</button></div>';
    sugestao.querySelector('.sim').addEventListener('click', function (e) { e.stopPropagation(); escolher(id); });
    sugestao.querySelector('.nao').addEventListener('click', function (e) { e.stopPropagation(); esconderSugestao(); });
    wrap.appendChild(sugestao);
    try { localStorage.setItem(CHAVE_SUGESTAO, '1'); } catch (e) {}
  }

  function linguaDoBrowser() {
    var ls = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'pt'];
    for (var i = 0; i < ls.length; i++) {
      var tag = String(ls[i] || '').toLowerCase();
      var c = tag.slice(0, 2);
      if (c === 'pt') return tag === 'pt-pt' ? 'pe' : 'pt';
      if (c === 'uk') return 'ua';
      if (COL.hasOwnProperty(c) || EX.D.hasOwnProperty(c)) return c;
    }
    return 'en';
  }

  function iniciar() {
    var wrap = montarSeletor();
    var guardada = null;
    try { guardada = localStorage.getItem(CHAVE); } catch (e) {}
    observar();
    if (guardada && LANGS.some(function (l) { return l.id === guardada; })) {
      aplicar(guardada);
    } else {
      aplicar('pt');
      // O site abre sempre em PT; a quem tem o telemovel noutra lingua
      // sugere-se, uma unica vez, mudar.
      var b = linguaDoBrowser();
      var jaSugerido = null;
      try { jaSugerido = localStorage.getItem(CHAVE_SUGESTAO); } catch (e) {}
      if (b !== 'pt' && !jaSugerido) sugerir(wrap, b);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
