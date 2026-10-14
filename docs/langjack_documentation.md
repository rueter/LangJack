#LangJack V1.0

LangJack extension, finite-state approach to language documentation in your pocket.

What kind of person builds this? Someone with an interest in linguistic morphological analysis, interlinear glossing and the desire to multifacilitate linguistic undertakings with the power of hfst-js, UralicNLP dictionaries and Veʹrdd while adhering to principal open-source structures with practices developed and maintained at Apertium and GiellaLT.
 
The author, Jack Rueter, has been working on finite-state descriptions of many of these language, beginning in 1996 and is introducing new languages, even today. Finite-state description of these languages has also meant procuring, maintaining and developing lexical assets, and these are much of what have been made available directly through the dictionary transducers. Jack has been able to accomplish much of this work in language description by collaborating in the GiellaLT infrastructure on Github, where most of his code is freely available.  

The idea was to take open-source tools that I myself have built, helped build and even ones by colleagues and apply them in a place where I could actually use them in everyday tasks. A simple day working with the description of languages may involve analyzing a single word or a entire sentence. For subsequent reference we may want to gloss it and translate it. The result might be useful in a linguistics article, the addition of entries to a treebank or maybe providing translation pairs for a dictionary. Now, I can read something online and if I find a word I don't know, I can right click on it and get a translation. 

The LangJack helps me to take command of simple tasks and I hope to contnue developing it so it will be useful for others as well. 

First, a brief overview of what is here: finite-state analyzers and dictionaries with just a few rudimentary but helpful functions.

#Analyzers

Languages covered:
By default the following transducers are shown in the scroll down menu.
Finnic
fin (Finnish), fkv (Kven), olo (Livvi-Karelian);
Saamic
sme (North Sami), smn (Inari Sami), sms (Skolt Sami);
Permian
koi (Komi-Permyak), kpv (Komi-Zyrian), udm (Udmurt);
Mordvin
mdf (Moksha), myv (Erzya);
Mari
mhr (Meadow Mari and Eastern Mari), mrj (Hill Mari, aka Western Mari)

Other transducers, however, can actually be made available by merely editing the <Custom ISO> button at the bottom of the scroll-down menu. Languages to be revealed will include, for example ‹liv› for Livonian, ‹vro› for Võro, ‹yrk› for Nenets (Tundra Nenets), or even ‹apu› for Apurinã, an Arawak language of the upper Amazon, and ‹lut› for Lushootseed, a Salishan language from the Salish Sea region.

#Dictionaries

Collaboration with the people in the open-source GiellaLT and Apertium infrastructures have made Jack aware of dictionary pairs that are easily utilized for the purpose of this tool. At present the dictionary contains over one and a half translation pair of the type (sms_piânnai:eng_dog|eng_dog:sms_piânnai)

None of the dictionaries are complete, but they are relatively extensive in enough languages to help in the glossing of texts. There is also a possibility for entering .TSV dictionaries of your own to complement the dictionary FSTs.

The accompanying screenshots 0 through 6 will provide a rough idea of what you can do with the LangJack.

00) Shows a picture of a single word that has been right clicked. Now, we want to select the ‹Lemma Viewing, Morphology Toggle..›

01) After a short wait the HFST Dictionary appears with a default language setting for Skolt Sami. You can see one morphological analysis, but there might be Alternative UralicNLP readings, too. Below that we can see dictionary translations, which in the case of ‹määnpââʹjj (lemma)›, have a good representation.

02) Shows the selection of an whole sentence, which has been select and right clicked. Here the entire sentence is shown with a German gloss for nearly every individual word -- the ‹deu› language code must be first among the default translations. Here we can also see an opportunity to ‹Analyze Gloss with HFST›, so we press it.

03) The selected text is brought into the UI ‹1. Input Text› field, where the source language, text language are shown as ‹sms (Skolt Sami)› -- these can be changed as noted above. We press the ‹Analyze Morphologically (hfst-js)› and then scroll down. (Remember this slide. You will come back to see it from 05 and 07.)

04) Here we can see each token displays a recognized base form with a Universal Dependencies part of speech. Next come possible morphological analyses, which can be changed either by selecting another alternative or writing in your own. Further down we see the number of glosses per language code and below that individual glosses to select from. Of course, here too it is possible to write your own gloss in any language, provided you have a three-letter code. Just write in your gloss, write in the desired three-letter language code and then press the check sign to save your work.

05) We see two items. Near the top, there is the opportunity to provide a translation in as many languages as you want. Below that, you can already see the Conllu format, where the GiellaLT tags have been automatically converted to Universal Dependencies Feature=Values. (Go back up to the bottom of slide 03, and you will find an ‹Annotate› button)

06) This is a picture of a tree I have just completed. Elementary, but it works. In the upper right, you will observe the ‹Prev› and ‹Next› buttons, but remember to press the ‹Save Treebank Changes› button before moving on. The treebanks are saved to an accumulative file that can be downloaded, retained or removed.

07) At the top of slide 03 you will notice a ‹Models & Dictionaries› button. This page reminds me to be curious. to go back and give some of the Skolt Sami words glosses in other languages. That glossing will show up here.

This is an incomplete introduction to the LangJack. Work continues and I am open to suggestions.

The Author, Jack Rueter, Ph.D.
