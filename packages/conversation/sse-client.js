export async function* readEvents(response) {
  if (!response.body) throw new Error('Missing event stream');
  const decoder = new TextDecoder(); let buffer = '';
  for await (const value of response.body) {
    buffer += decoder.decode(value, { stream: true }); let boundary;
    while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
      const block = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
      const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) yield JSON.parse(data);
    }
  }
  // An incomplete final event is not treated as completion; caller checks for a done event.
}
