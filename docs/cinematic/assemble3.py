import subprocess, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
def run(*a): subprocess.run(["ffmpeg","-loglevel","error","-y",*a],check=True)
def dur(f): return float(subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",f],capture_output=True,text=True).stdout)
E=["-c:v","libx264","-crf","17","-preset","medium","-pix_fmt","yuv420p","-r","30","-an"]
def game(name, d, start=0, speed=1.0, extra=""):
    vf=f"setpts=PTS/{speed},fps=30" + (","+extra if extra else "")
    run("-framerate","30","-start_number",str(start),"-i",f"modern/{name}/f%04d.jpg","-t",str(d),"-vf",vf,*E,f"v_{name}.mp4"); return f"v_{name}.mp4"
def anc(name, s0, s1, extra=""):
    vf="fps=30" + (","+extra if extra else "")
    run("-framerate","24","-start_number",str(int(s0*24)),"-i","framesv/f%05d.jpg","-t",str(s1-s0),"-vf",vf,*E,f"a_{name}.mp4"); return f"a_{name}.mp4"
segs=[]
segs.append(game("m1",5.5,0,0.8,"fade=t=in:st=0:d=1"))                     # 0.0  night towers
segs.append(game("m2",5.0,0,0.8))                                           # 5.5  between towers
segs.append(game("m6",4.0,0,0.9))                                           # 10.5 city by day
segs.append(game("m4",5.0,40,1.0))                                          # 14.5 missile launch
segs.append(game("m3",4.0,0,0.8))                                           # 19.5 sunset
segs.append(anc("disc",0,22,"fade=t=in:st=0:d=0.8"))                        # 23.5 night castle, gate, storm, white (scene 21.6 → 45.1)
segs.append(game("m8",5.9,1,1.0,"fade=t=in:st=0:d=0.6:color=white,fade=t=out:st=5.1:d=0.8:color=white"))  # 45.5 the rewind
segs.append(anc("aerial",22,30,"fade=t=in:st=0:d=1:color=white"))           # 52.5 dawn from the air
segs.append(anc("fardune",70,76))                                           # 60.5
segs.append(anc("dunes",30,36))                                             # 66.5
segs.append(anc("sword",36,44))                                             # 72.5
segs.append(anc("roofs",82,88))                                             # 80.5
segs.append(anc("camp",44,50))                                              # 86.5
segs.append(anc("tower",76,82))                                             # 92.5
segs.append(anc("avenue",52,58))                                            # 98.5
segs.append(anc("title",62,70))                                             # 104.5 (title at scene 64.2 → 106.7)
starts=[]; t=0
for s in segs: starts.append(t); t+=dur(s)
print("starts", [round(x,2) for x in starts], "total", round(t,2))
open("list3.txt","w").write("".join(f"file '{s}'\n" for s in segs))
run("-f","concat","-safe","0","-i","list3.txt","-c","copy","video3.mp4")
total=t
# ---- narration: line, video time ----
st=dict(zip(["m1","m2","m6","m4","m3","disc","m8","aerial","fardune","dunes","sword","roofs","camp","tower","avenue","title"],starts))
cues=[("a1",st["m1"]+0.8),("a2",st["m2"]+0.4),("a3",st["m6"]+1.2),("a4",st["m3"]+0.3),
      ("b1",st["disc"]+1.5),("b2",st["disc"]+8.0),("b3",st["disc"]+15.0),
      ("r1",st["m8"]+1.0),("b4n",st["aerial"]+1.2),("b5",st["fardune"]+0.8),("b6",st["sword"]+0.6),
      ("b7",st["roofs"]+0.5),("b8",st["tower"]+0.6),("b9",st["avenue"]+1.5)]
# ---- music: the score from 16 s; its battle part repeated once so it reaches the title ----
run("-ss","16","-t","89","-i","music/score2.mp3","-ss","85","-t","20","-i","music/score2.mp3","-ss","105","-i","music/score2.mp3",
    "-filter_complex","[0][1]acrossfade=d=2:c1=tri:c2=tri[x];[x][2]acrossfade=d=1.5:c1=tri:c2=tri[m]","-map","[m]","-c:a","pcm_s16le","music_full.wav")
ins=[]; fl=[]; vo=[]; fx=[]
def inp(path): ins.extend(["-i",path]); return len(ins)//2-1
m=inp("music_full.wav"); fl.append(f"[{m}]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.42,afade=t=out:st={total-3:.2f}:d=3[mus]")
def sfx(path,start,vol,extra=""):
    i=inp(path); ms=int(start*1000); fl.append(f"[{i}]aformat=sample_rates=48000:channel_layouts=stereo,volume={vol}{extra},adelay={ms}|{ms}[f{i}]"); fx.append(f"[f{i}]")
sfx("sfx/city.mp3",0,0.16,",afade=t=in:d=1.5,afade=t=out:st=11:d=3")
sfx("sfx/launch.mp3",st["m4"]+0.8,0.32)
sfx("sfx/night.mp3",st["disc"],0.22,",afade=t=in:d=2,afade=t=out:st=12:d=3")
sfx("sfx/storm.mp3",st["disc"]+14,0.3,",afade=t=in:d=1.5,afade=t=out:st=6:d=1.5")
sfx("sfx/gate.mp3",st["disc"]+18.5,0.35)
sfx("sfx/riser.mp3",st["m8"]+1.5,0.3)
sfx("sfx/hit.mp3",st["aerial"]-0.2,0.35)
sfx("sfx/dawn.mp3",st["aerial"],0.18,",afade=t=in:d=2,afade=t=out:st=16:d=4")
sfx("sfx/hit.mp3",st["title"]+2.0,0.3)
for k,t in cues:
    i=inp(f"vo/{k}.mp3"); ms=int(t*1000)
    fl.append(f"[{i}]aformat=sample_rates=48000:channel_layouts=stereo,highpass=f=80,acompressor=threshold=0.1:ratio=3:attack=5:release=120,volume=2.2,adelay={ms}|{ms}[v{i}]"); vo.append(f"[v{i}]")
fl.append(f"{''.join(vo)}amix=inputs={len(vo)}:normalize=0,apad[vo]")
fl.append("[vo]asplit=2[vo1][vo2]")
fl.append(f"{''.join(fx)}amix=inputs={len(fx)}:normalize=0,apad[fxs]")
fl.append("[fxs][mus]amix=inputs=2:normalize=0[bed]")
fl.append("[bed][vo1]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350:makeup=1[duck]")
fl.append(f"[duck][vo2]amix=inputs=2:normalize=0:duration=first,atrim=0:{total:.2f},loudnorm=I=-14:TP=-1.5:LRA=9[a]")
run(*ins,"-filter_complex",";".join(fl),"-map","[a]","-c:a","aac","-b:a","256k","-ar","48000","mix3.m4a")
# ---- subtitles ----
vins=["-i","video3.mp4"]; vf=[]; last="[0:v]"
for n,(k,t) in enumerate(cues,1):
    d=dur(f"vo/{k}.mp3")+0.5
    vins+=["-loop","1","-t",f"{d:.2f}","-i",f"subs/{k}.png"]
    vf.append(f"[{n}:v]format=rgba,fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st={d-0.4:.2f}:d=0.4:alpha=1,setpts=PTS+{t:.2f}/TB[s{n}]")
    vf.append(f"{last}[s{n}]overlay=0:930:eof_action=pass:enable='between(t,{t:.2f},{t+d:.2f})'[o{n}]"); last=f"[o{n}]"
run(*vins,"-i","mix3.m4a","-filter_complex",";".join(vf),"-map",last,"-map",f"{len(cues)+1}:a","-t",f"{total:.2f}","-c:v","libx264","-crf","21","-preset","medium","-pix_fmt","yuv420p","-c:a","copy","-movflags","+faststart","jouf-trailer-v3.mp4")
print("done", total)
