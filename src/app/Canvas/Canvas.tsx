import { useRef, useEffect } from "react";
import { Delaunay } from "d3-delaunay";

type Point = [x: number, y: number];

export default function Canvas({ width = 800, height = 600 }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // const frameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const dots: Point[] = [];

    function draw(context: CanvasRenderingContext2D) {
      context.canvas.width = width;
      context.canvas.height = height;

      context.fillStyle = "black";
      context.fillRect(0, 0, width, height);

      for (let i = 0; i < 50; i++) {
        const x = Math.floor(Math.random() * width);
        const y = Math.floor(Math.random() * height);
        const dot: Point = [x, y]
        dots.push(dot)

        context.beginPath();
        context.strokeStyle = "rgb(110, 110, 110)";
        context.arc(x, y, 1, 0, Math.PI * 2, false);
        context.fillStyle = "rgb(110, 110, 110)";
        context.fill();
      }

      const delaunay = Delaunay.from(dots);
      const voronoi = delaunay.voronoi([0, 0, width, height]);
      context.beginPath();
      delaunay.renderPoints(context);
      context.fill();
      context.beginPath();
      voronoi.render(context);
      context.stroke();

      const lightArray = [3, 15, 24, 37, 42, 44];

      for (const i in lightArray) {
        const polygon = voronoi.cellPolygon(Number(i));
        if (polygon) {
          context.beginPath();
          context.moveTo(polygon[0][0], polygon[0][1]);
          for (let j = 1; j < polygon.length; j++) {
            context.lineTo(polygon[j][0], polygon[j][1]);
          }
          context.closePath();

          context.fillStyle = "rgb(153, 152, 151)";
          context.fill();

          context.strokeStyle = "rgb(214, 213, 212)"; // kantfärg
          context.lineWidth = 2;
          context.stroke();
        }
      }



      // frameRef.current = requestAnimationFrame(()=>draw(context));
    }

    if(context){
      draw(context)
    }

    // return () => cancelAnimationFrame(frameRef.current); // rensa loopen om komponenten avmonteras
  }, [width, height]); // körs när width/height ändras

  return <canvas ref={canvasRef} />;
}
