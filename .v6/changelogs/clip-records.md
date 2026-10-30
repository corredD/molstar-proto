## prism-me: a clip's parts read and written as Prism's records

- Fix (the #18 and #20 merge): a clip given a second part of a model (Cut also, Use a clip) listed only the first, and
  × on a part did nothing. Prism's particle cuts are now a record a part (tag and selector); the app wrote one merged
  record a clip and read the first. It now adds a record for the part it gives, reads every record of the clip (their
  union), and takes a part off each record (all of a model cut: a record of every particle less the part).
