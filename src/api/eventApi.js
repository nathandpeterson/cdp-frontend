import * as firebase from "firebase";
import moment from "moment";
import natural from "natural";
import { flatten, sortBy, reverse, groupBy, mapValues, filter } from "lodash";
import { getAllResources, getSingleResource, getResourceById } from "./baseApi";
import { fetchJson } from "./utils";

const storage = firebase.storage();

export async function getAllEvents() {
  return getAllResources("event");
}

/**
 * @param {object} takes a single record from getAll, just needs {id: id}
 * @returns {object} returns the same object with the transcript attached
 */

export async function getEventMinutes(eventId) {
  try {
    const eventMinutes = await getSingleResource(
      "event_minutes_item",
      "event_id",
      eventId
    );
    return eventMinutes;
  } catch (e) {
    return Promise.reject(e);
  }
}

export async function getEventMinutesItem(eventMinutesItemId) {
  try {
    const {
      minutes_item_id,
      created,
      decision,
      event_id,
      index
    } = await getResourceById("event_minutes_item", eventMinutesItemId);
    const minutesItem = await getResourceById("minutes_item", minutes_item_id);
    const minutesItemFile = await getSingleResource(
      "minutes_item_file",
      "minutes_item_id",
      minutes_item_id
    );

    return {
      id: eventMinutesItemId,
      created,
      decision,
      event_id,
      index,
      minutes_item: {
        id: minutes_item_id,
        ...minutesItem,
        file: minutesItemFile
      }
    };
  } catch (e) {
    return Promise.reject(e);
  }
}

export async function getEventBody(bodyId) {
  try {
    const body = await getResourceById("body", bodyId);
    return body;
  } catch (e) {
    return Promise.reject(e);
  }
}

export async function getEventTranscriptMetadata(eventId) {
  try {
    const [firstTranscript] = await getSingleResource(
      "transcript",
      "event_id",
      eventId
    );

    const transcriptMetadata = await getResourceById(
      "file",
      firstTranscript.file_id
    );

    // https://firebase.google.com/docs/storage/web/download-files
    const gsReference = storage.refFromURL(transcriptMetadata.uri);
    const transcript = await gsReference
      .getDownloadURL()
      .then(url => fetchJson(url));

    return transcript;
  } catch (e) {
    return Promise.reject(e);
  }
}

export async function getVotesForEvent(eventId) {
  // get all minute items for a single event
  const extractedMinutes = await getSingleResource(
    "event_minutes_item",
    "event_id",
    eventId
  );
  // filter out minute items that are not votes
  const minuteItemsWithDecisions = extractedMinutes.filter(
    minute => minute.decision !== null
  );

  // instead of getting all minutes items, we could create an array of promises as below
  const allMinuteItems = await getAllResources("minutes_item");
  const formattedItems = [];
  minuteItemsWithDecisions.forEach(item => {
    const thisMinuteItem = allMinuteItems.find(
      minuteItem => minuteItem.id === item.minutes_item_id
    );
    formattedItems.push({
      matter: thisMinuteItem.matter,
      name: thisMinuteItem.name,
      id: item.id,
      decision: item.decision
    });
  });

  const allPeople = await getAllResources("person");
  const promises = [];
  formattedItems.forEach(item => {
    const getVotesForMinuteItem = getSingleResource(
      "vote",
      "event_minutes_item_id",
      item.id
    );
    promises.push(getVotesForMinuteItem);
  });
  await Promise.all(promises).then(res => {
    res.forEach(votesForMinuteItem => {
      const thisEventMinutesItemId =
        votesForMinuteItem[0].event_minutes_item_id;
      const formattedMinutesItem = formattedItems.find(
        item => item.id === thisEventMinutesItemId
      );
      const votesByPerson = [];
      votesForMinuteItem.forEach(unformattedVote => {
        const person = allPeople.find(
          person => person.id === unformattedVote.person_id
        );
        votesByPerson.push({
          decision: unformattedVote.decision,
          person_id: unformattedVote.person_id,
          full_name: person.full_name
        });
      });
      formattedMinutesItem.formattedIndividualVotes = votesByPerson;
    });
  });
  return formattedItems;
}

export async function getEventById(id) {
  try {
    const event = await getResourceById("event", id);
    const body = await getEventBody(event.body_id);
    const minutes = await getEventMinutes(id);
    const minutesItems = await Promise.all(
      minutes.map(({ id }) => getEventMinutesItem(id))
    );
    const transcript = await getEventTranscriptMetadata(id);

    return {
      id,
      name: body.name,
      description: body.description,
      videoUrl: event.video_uri,
      date: moment
        .utc(event.event_datetime.toDate())
        .format("MM-DD-YYYY HH:MM:SS"),
      minutes: sortBy(minutesItems, minuteItem => minuteItem.index),
      transcript: transcript.data,
      scPageUrl: event.source_uri
    };
  } catch (e) {
    return Promise.reject(e);
  }
}

export async function getBasicEventById(id) {
  try {
    const event = await getResourceById("event", id);
    const body = await getEventBody(event.body_id);

    return {
      id,
      name: body.name,
      description: body.description,
      date: moment
        .utc(event.event_datetime.toDate())
        .format("MM-DD-YYYY HH:MM:SS")
    };
  } catch (e) {
    return Promise.reject(e);
  }
}

export async function getEventsByIndexedTerm(term) {
  const valueMin = 0;
  try {
    natural.PorterStemmer.attach();

    const stemmedTokens = term.tokenizeAndStem();

    // get matches for each term
    const matches = await Promise.all(
      stemmedTokens.map(stemmedToken =>
        getSingleResource("indexed_event_term", "term", stemmedToken)
      )
    );

    // create a map of event id to object with id and sum of match values
    const summedMatchValueByEventId = mapValues(
      groupBy(flatten(matches), match => match.event_id),
      (eventTermMatches, key) =>
        eventTermMatches.reduce(
          (current, item) => ({
            ...current,
            value: current.value + item.value
          }),
          { event_id: key, value: 0 }
        )
    );

    // reverse to get highest value first
    const sortedSummedMatches = reverse(
      sortBy(
        filter(summedMatchValueByEventId, ({ value }) => value >= valueMin),
        ({ value }) => value
      )
    );

    // fetch events in order of value and return
    const events = await Promise.all(
      sortedSummedMatches.map(({ event_id }) => getBasicEventById(event_id))
    );

    return events;
  } catch (e) {
    return Promise.reject(e);
  }
}
